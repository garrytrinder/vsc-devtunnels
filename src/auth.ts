import * as vscode from 'vscode';
import { DevTunnelsCli } from './cli';

export class AuthManager {
    private readonly _onDidChangeAuth = new vscode.EventEmitter<void>();
    readonly onDidChangeAuth = this._onDidChangeAuth.event;

    constructor(private cli: DevTunnelsCli) {}

    async ensureLoggedIn(force = false): Promise<boolean> {
        if (!force && await this.cli.isLoggedIn()) {
            return true;
        }

        if (force) {
            await this.cli.logout();
        }

        // Pick a provider and do interactive login via terminal
        const provider = await vscode.window.showQuickPick(
            [
                { label: 'GitHub', description: 'Login with your GitHub account', provider: 'github' as const },
                { label: 'Microsoft', description: 'Login with your Microsoft account', provider: 'microsoft' as const },
            ],
            { placeHolder: 'Dev Tunnels: Login required — select an account type' }
        );

        if (!provider) {
            return false;
        }

        await this.interactiveLogin(provider.provider);
        return this.cli.isLoggedIn();
    }

    private async interactiveLogin(provider: 'github' | 'microsoft'): Promise<void> {
        const flag = provider === 'github' ? '-g' : '';
        const authMethod = vscode.workspace.getConfiguration('devtunnels').get<string>('authMethod', 'browser');
        const deviceCodeFlag = authMethod === 'deviceCode' ? '-d' : '';
        const args = ['user', 'login', flag, deviceCodeFlag].filter(Boolean);

        try {
            // 5 minute timeout — browser auth can take a while
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Dev Tunnels: Waiting for login...',
                    cancellable: false,
                },
                async () => {
                    await this.cli.exec(args, { timeout: 300000 });
                }
            );
            this._onDidChangeAuth.fire();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Dev Tunnels: Login failed — ${message}`);
        }
    }

    dispose(): void {
        this._onDidChangeAuth.dispose();
    }
}

