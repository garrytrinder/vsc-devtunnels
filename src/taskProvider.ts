import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DevTunnelsCli } from './cli';
import { AuthManager } from './auth';

interface DevTunnelTaskDefinition extends vscode.TaskDefinition {
    operation?: 'host' | 'stop';
    tunnelType?: 'temporary' | 'persistent';
    tunnelId?: string;
    port?: number;
    access?: 'anonymous' | 'tenant' | { org: string };
    protocol?: 'http' | 'https' | 'auto';
    expiration?: '1h' | '2h' | '4h' | '8h' | '1d' | '2d' | '7d' | '14d' | '30d';
    description?: string;
    labels?: string[];
    hostHeader?: string;
    originHeader?: string;
    requestTimeout?: number;
    envFilePath?: string;
    envUrlVariable?: string;
}

export class DevTunnelTaskProvider implements vscode.TaskProvider {
    static readonly type = 'devtunnel';

    constructor(
        private cli: DevTunnelsCli,
        private auth: AuthManager,
        private outputChannel: vscode.OutputChannel
    ) {}

    provideTasks(): vscode.Task[] {
        return [];
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const definition = task.definition as DevTunnelTaskDefinition;
        const operation = definition.operation ?? 'host';

        switch (operation) {
            case 'host':
                return this.resolveHostTask(definition, task);
            case 'stop':
                return this.resolveStopTask(definition, task);
            default:
                return undefined;
        }
    }

    private resolveHostTask(definition: DevTunnelTaskDefinition, task: vscode.Task): vscode.Task {
        const scope = task.scope;
        const execution = new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
            return new DevTunnelHostTerminal(this.cli, this.auth, definition, this.outputChannel, scope);
        });

        const resolvedTask = new vscode.Task(
            definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.name,
            'devtunnel',
            execution,
            '$devtunnel-host'
        );

        resolvedTask.isBackground = true;
        return resolvedTask;
    }

    private resolveStopTask(definition: DevTunnelTaskDefinition, task: vscode.Task): vscode.Task {
        const execution = new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
            return new DevTunnelStopTerminal(definition, this.outputChannel);
        });

        return new vscode.Task(
            definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.name,
            'devtunnel',
            execution
        );
    }
}

class DevTunnelHostTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidWrite = this.writeEmitter.event;
    onDidClose = this.closeEmitter.event;

    private process: cp.ChildProcess | undefined;
    private tunnelUrl: string | undefined;

    constructor(
        private cli: DevTunnelsCli,
        private auth: AuthManager,
        private definition: DevTunnelTaskDefinition,
        private outputChannel: vscode.OutputChannel,
        private scope?: vscode.TaskScope | vscode.WorkspaceFolder
    ) {}

    async open(): Promise<void> {
        // Ensure logged in before starting
        const loggedIn = await this.auth.ensureLoggedIn();
        if (!loggedIn) {
            this.writeEmitter.fire('Error: Not logged in. Please login first.\r\n');
            this.closeEmitter.fire(1);
            return;
        }

        // For persistent tunnels, ensure the tunnel exists first
        if (this.definition.tunnelType === 'persistent' && this.definition.tunnelId) {
            const ready = await this.ensureTunnelExists(this.definition.tunnelId);
            if (!ready) {
                this.closeEmitter.fire(1);
                return;
            }
        }

        await this.startTunnel();
    }

    private static readonly REAUTH_FAILED_MESSAGE = 'Re-authentication failed.';

    private static isTokenExpiredError(e: unknown): boolean {
        const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
        return message.includes('token expired');
    }

    private static isReauthFailedError(e: unknown): boolean {
        const message = e instanceof Error ? e.message : String(e);
        return message === DevTunnelHostTerminal.REAUTH_FAILED_MESSAGE;
    }

    /**
     * Run a CLI command, transparently re-authenticating and retrying once if
     * the call fails because the user's login token has expired. The CLI's
     * `user show` command can report the user as logged in even when the
     * cached token is no longer valid for tunnel operations, so per-call
     * recovery is needed here in addition to the host-process retry.
     */
    private async execWithReauth(args: string[]): Promise<string> {
        try {
            return await this.cli.exec(args);
        } catch (e: unknown) {
            if (!DevTunnelHostTerminal.isTokenExpiredError(e)) {
                throw e;
            }

            this.writeEmitter.fire('\r\nLogin token expired. Re-authenticating...\r\n');
            this.outputChannel.appendLine('[Tunnel] Token expired, attempting re-auth');

            const loggedIn = await this.auth.ensureLoggedIn();
            if (!loggedIn) {
                throw new Error(DevTunnelHostTerminal.REAUTH_FAILED_MESSAGE);
            }

            this.writeEmitter.fire('Re-authenticated. Retrying...\r\n');
            return this.cli.exec(args);
        }
    }

    private async ensureTunnelExists(tunnelId: string): Promise<boolean> {
        try {
            await this.execWithReauth(['show', tunnelId]);
            this.writeEmitter.fire(`Tunnel ${tunnelId} found.\r\n`);
        } catch (showError: unknown) {
            // `show` failing usually means the tunnel doesn't exist. If
            // re-authentication failed during the wrapped retry, surface that
            // instead of trying to create a tunnel we can't authenticate for.
            if (DevTunnelHostTerminal.isReauthFailedError(showError)) {
                const message = showError instanceof Error ? showError.message : String(showError);
                this.writeEmitter.fire(`Error: ${message}\r\n`);
                this.outputChannel.appendLine(`[Tunnel] ${message}`);
                return false;
            }

            this.writeEmitter.fire(`Tunnel ${tunnelId} not found. Creating...\r\n`);
            this.outputChannel.appendLine(`[Tunnel] Creating persistent tunnel: ${tunnelId}`);
            try {
                await this.execWithReauth(['create', tunnelId]);
                this.writeEmitter.fire(`Tunnel ${tunnelId} created.\r\n`);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                this.writeEmitter.fire(`Error: Could not create tunnel: ${message}\r\n`);
                this.outputChannel.appendLine(`[Tunnel] Failed to create tunnel: ${message}`);
                return false;
            }
        }

        // Add port to the tunnel
        if (this.definition.port !== undefined) {
            await this.addPort(tunnelId, this.definition.port);
            await this.updatePort(tunnelId, this.definition.port);
        }

        // Set access control
        await this.setTunnelAccess(tunnelId);
        return true;
    }

    private async addPort(tunnelId: string, port: number): Promise<void> {
        try {
            const portArgs = ['port', 'create', tunnelId, '-p', port.toString()];
            if (this.definition.protocol && this.definition.protocol !== 'auto') {
                portArgs.push('--protocol', this.definition.protocol);
            }
            await this.execWithReauth(portArgs);
            this.writeEmitter.fire(`Port ${port} added to tunnel.\r\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            const msg = message.toLowerCase();
            if (!msg.includes('already exists') && !msg.includes('conflict')) {
                this.writeEmitter.fire(`Warning: Could not add port ${port}: ${message}\r\n`);
            }
        }
    }

    private async updatePort(tunnelId: string, port: number): Promise<void> {
        // Apply port-level options (e.g. --host-header) via `port update`. The
        // tunnel relay reads these settings from the port, not from the host
        // command, so for persistent tunnels they must be set here.
        const updateArgs: string[] = [];

        if (this.definition.hostHeader) {
            updateArgs.push('--host-header', this.definition.hostHeader);
        }

        if (updateArgs.length === 0) {
            return;
        }

        try {
            await this.execWithReauth(['port', 'update', tunnelId, '-p', port.toString(), ...updateArgs]);
            this.writeEmitter.fire(`Port ${port} settings updated.\r\n`);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.writeEmitter.fire(`Warning: Could not update port ${port} settings: ${message}\r\n`);
        }
    }

    private async setTunnelAccess(tunnelId: string): Promise<void> {
        const access = this.definition.access;
        if (!access) {
            return;
        }

        try {
            if (access === 'anonymous') {
                await this.execWithReauth(['access', 'create', tunnelId, '-a']);
            } else if (access === 'tenant') {
                await this.execWithReauth(['access', 'create', tunnelId, '-t']);
            } else if (typeof access === 'object' && access.org) {
                await this.execWithReauth(['access', 'create', tunnelId, '-o', access.org]);
            }
        } catch {
            // Access may already be set
        }
    }



    private async startTunnel(isRetry = false): Promise<void> {
        const args = this.buildArgs();
        const cliPath = this.cli.getCliPath();

        this.writeEmitter.fire(`Starting tunnel: ${cliPath} ${args.join(' ')}\r\n`);
        this.outputChannel.appendLine(`[Tunnel] Starting: ${cliPath} ${args.join(' ')}`);

        let stderrOutput = '';

        this.process = cp.spawn(cliPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.process.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
            this.outputChannel.appendLine(`[Tunnel] ${text.trim()}`);
            this.parseOutput(text);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            stderrOutput += text;
            this.writeEmitter.fire(text.replace(/\n/g, '\r\n'));
            this.outputChannel.appendLine(`[Tunnel ERROR] ${text.trim()}`);
        });

        this.process.on('close', async (code) => {
            this.outputChannel.appendLine(`[Tunnel] Process exited with code ${code}`);

            // Detect expired token and retry once after re-auth
            if (code !== 0 && !isRetry && DevTunnelHostTerminal.isTokenExpiredError(stderrOutput)) {
                this.writeEmitter.fire('\r\nLogin token expired. Re-authenticating...\r\n');
                this.outputChannel.appendLine('[Tunnel] Token expired, attempting re-auth');

                const loggedIn = await this.auth.ensureLoggedIn();
                if (loggedIn) {
                    this.writeEmitter.fire('Re-authenticated. Retrying tunnel...\r\n\r\n');
                    await this.startTunnel(true);
                    return;
                }

                this.writeEmitter.fire('Re-authentication failed.\r\n');
                this.closeEmitter.fire(1);
                return;
            }

            this.closeEmitter.fire(code ?? 1);
        });
    }

    close(): void {
        if (this.process) {
            this.process.kill('SIGTERM');
        }
    }

    private buildArgs(): string[] {
        const args: string[] = ['host'];
        const def = this.definition;

        if (def.tunnelType === 'persistent' && def.tunnelId) {
            // Persistent: ports/access are configured separately, just pass the tunnel ID
            args.push(def.tunnelId);
        } else {
            // Temporary: pass port and flags inline
            if (def.port !== undefined) {
                args.push('-p', def.port.toString());
            }

            if (def.access === 'anonymous') {
                args.push('--allow-anonymous');
            }

            if (def.protocol && def.protocol !== 'auto') {
                args.push('--protocol', def.protocol);
            }
        }

        if (def.expiration) {
            args.push('--expiration', def.expiration);
        }

        if (def.description) {
            args.push('--description', def.description);
        }

        if (def.labels && def.labels.length > 0) {
            args.push('--labels', ...def.labels);
        }

        if (def.hostHeader) {
            args.push('--host-header', def.hostHeader);
        }

        if (def.originHeader) {
            args.push('--origin-header', def.originHeader);
        }

        if (def.requestTimeout !== undefined) {
            args.push('--request-timeout', def.requestTimeout.toString());
        }

        return args;
    }

    private parseOutput(text: string): void {
        // Parse tunnel URL — prefer the subdomain-embedded port form
        // (e.g. https://xxx-3000.uks1.devtunnels.ms) over the port-suffixed form
        const urlMatches = text.match(/https:\/\/\S+devtunnels\.ms\S*/g);
        if (urlMatches && !this.tunnelUrl) {
            const cleaned = urlMatches.map(u => u.replace(/[,;.]+$/, ''));
            this.tunnelUrl = cleaned.find(u => !/:\d+$/.test(u) && !u.includes('-inspect')) ?? cleaned[0];
            this.writeToEnvFile();
        }
    }

    private getEnvFileFormat(): 'dotenv' | 'json' {
        const filePath = this.definition.envFilePath ?? '';
        const ext = path.extname(filePath).toLowerCase();
        const basename = path.basename(filePath).toLowerCase();

        if (ext === '.json') { return 'json'; }
        if (basename.startsWith('.env') || ext === '.env') { return 'dotenv'; }

        throw new Error(`Cannot determine format for '${filePath}'. Use a .env or .json file extension.`);
    }

    private writeToEnvFile(): void {
        if (!this.definition.envFilePath || !this.tunnelUrl) {
            return;
        }

        const workspaceFolder = this.scope && typeof this.scope === 'object' && 'uri' in this.scope
            ? this.scope.uri.fsPath
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceFolder) {
            return;
        }

        const envFilePath = path.resolve(workspaceFolder, this.definition.envFilePath);

        let format: 'dotenv' | 'json';
        try {
            format = this.getEnvFileFormat();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.writeEmitter.fire(`\r\nError: ${message}\r\n`);
            this.outputChannel.appendLine(`[Tunnel] ${message}`);
            return;
        }

        const urlVar = this.definition.envUrlVariable
            ?? (format === 'json' ? 'DevTunnelUrl' : 'DEVTUNNEL_URL');

        let content = '';
        try {
            content = fs.readFileSync(envFilePath, 'utf-8');
        } catch {
            this.writeEmitter.fire(`\r\nError: File '${this.definition.envFilePath}' does not exist.\r\n`);
            this.outputChannel.appendLine(`[Tunnel] Env file not found: ${envFilePath}`);
            return;
        }

        if (format === 'json') {
            content = this.writeJson(content, urlVar, this.tunnelUrl);
        } else {
            content = this.writeDotenv(content, urlVar, this.tunnelUrl);
        }

        fs.writeFileSync(envFilePath, content, 'utf-8');

        this.writeEmitter.fire(`\r\nWrote tunnel info to ${this.definition.envFilePath} (${format})\r\n`);
        this.outputChannel.appendLine(`[Tunnel] Wrote env file: ${envFilePath} [${format}]`);
    }

    private writeDotenv(content: string, key: string, value: string): string {
        const regex = new RegExp(`^${this.escapeRegex(key)}=.*$`, 'm');
        const line = `${key}=${value}`;
        if (regex.test(content)) {
            return content.replace(regex, line);
        }
        return content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
    }

    private writeJson(content: string, key: string, value: string): string {
        let obj: Record<string, unknown> = {};
        if (content.trim()) {
            try {
                obj = JSON.parse(content);
            } catch {
                obj = {};
            }
        }
        obj[key] = value;
        return JSON.stringify(obj, null, 2) + '\n';
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

class DevTunnelStopTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidWrite = this.writeEmitter.event;
    onDidClose = this.closeEmitter.event;

    constructor(
        private definition: DevTunnelTaskDefinition,
        private outputChannel: vscode.OutputChannel
    ) {}

    async open(): Promise<void> {
        // Both persistent and temporary tunnels run as VS Code tasks — terminate them
        await this.stopHostTasks();
    }

    close(): void {}

    private async stopHostTasks(): Promise<void> {
        this.writeEmitter.fire('Stopping tunnel host tasks...\r\n');
        this.outputChannel.appendLine('[Tunnel] Stopping running host tasks');

        // If a specific tunnelId is given, only stop that one
        const targetTunnelId = this.definition.tunnelId;

        const runningTasks = vscode.tasks.taskExecutions.filter(e => {
            if (e.task.definition.type !== 'devtunnel') { return false; }
            const def = e.task.definition as DevTunnelTaskDefinition;
            const op = def.operation ?? 'host';
            if (op !== 'host') { return false; }
            if (targetTunnelId && def.tunnelId && def.tunnelId !== targetTunnelId) { return false; }
            return true;
        });

        if (runningTasks.length === 0) {
            this.writeEmitter.fire('No running tunnel tasks found.\r\n');
            this.closeEmitter.fire(0);
            return;
        }

        for (const execution of runningTasks) {
            this.writeEmitter.fire(`Terminating task: ${execution.task.name}\r\n`);
            execution.terminate();
        }

        this.writeEmitter.fire(`Stopped ${runningTasks.length} tunnel task(s).\r\n`);
        this.closeEmitter.fire(0);
    }
}
