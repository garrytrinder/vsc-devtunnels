import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';

export class DevTunnelsCli {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    getCliPath(): string {
        return vscode.workspace.getConfiguration('devtunnels').get<string>('cliPath', 'devtunnel');
    }

    async isInstalled(): Promise<boolean> {
        try {
            await this.exec(['--version']);
            return true;
        } catch {
            return false;
        }
    }

    async getVersion(): Promise<string> {
        const output = await this.exec(['--version']);
        const match = output.match(/(\d+\.\d+\.\d+)/);
        return match ? match[1] : output.trim();
    }

    async getLatestVersion(): Promise<string | undefined> {
        const platform = os.platform();

        try {
            switch (platform) {
                case 'darwin': {
                    const output = await this.execCommand('brew', ['info', '--json=v2', '--cask', 'devtunnel']);
                    const info = JSON.parse(output);
                    return info.casks?.[0]?.version;
                }
                case 'win32': {
                    const output = await this.execCommand('winget', ['show', 'Microsoft.devtunnel', '--versions']);
                    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
                    // First version line after the header
                    for (const line of lines) {
                        const match = line.match(/^(\d+\.\d+\.\d+)/);
                        if (match) {
                            return match[1];
                        }
                    }
                    return undefined;
                }
                default:
                    return undefined;
            }
        } catch {
            return undefined;
        }
    }

    async install(): Promise<void> {
        this.runInTerminal('install');
    }

    async upgrade(): Promise<void> {
        this.runInTerminal('upgrade');
    }

    private runInTerminal(action: 'install' | 'upgrade'): void {
        const platform = os.platform();
        let command: string;

        switch (platform) {
            case 'darwin':
                command = action === 'install'
                    ? 'brew install --cask devtunnel'
                    : 'brew upgrade --cask devtunnel';
                break;
            case 'win32':
                command = action === 'install'
                    ? 'winget install Microsoft.devtunnel'
                    : 'winget upgrade Microsoft.devtunnel';
                break;
            case 'linux':
                command = 'curl -sL https://aka.ms/DevTunnelCliInstall | bash';
                break;
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        const label = action === 'install' ? 'Install' : 'Upgrade';
        const terminal = vscode.window.createTerminal(`Dev Tunnels: ${label}`);
        terminal.show();
        terminal.sendText(command);
    }

    async isLoggedIn(): Promise<boolean> {
        try {
            const output = await this.exec(['user', 'show']);
            return !output.toLowerCase().includes('not logged in');
        } catch {
            return false;
        }
    }

    async logout(): Promise<void> {
        try {
            await this.exec(['user', 'logout']);
        } catch {
            // Already logged out — ignore
        }
    }

    exec(args: string[], options?: { timeout?: number }): Promise<string> {
        const cliPath = this.getCliPath();
        return this.execCommand(cliPath, args, options?.timeout);
    }

    private execCommand(command: string, args: string[], timeout = 30000): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.execFile(command, args, { timeout }, (error, stdout, stderr) => {
                if (error) {
                    this.outputChannel.appendLine(`[CLI Error] ${command} ${args.join(' ')}: ${stderr || error.message}`);
                    reject(new Error(stderr || error.message));
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }
}

