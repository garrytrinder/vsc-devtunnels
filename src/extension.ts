import * as vscode from 'vscode';
import { DevTunnelsCli } from './cli';
import { AuthManager } from './auth';
import { DevTunnelTaskProvider } from './taskProvider';
import { StatusBar } from './statusBar';

let statusBar: StatusBar;

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Dev Tunnels');
    const cli = new DevTunnelsCli(outputChannel);
    const auth = new AuthManager(cli);
    statusBar = new StatusBar(cli);

    // Register task provider
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider(
            DevTunnelTaskProvider.type,
            new DevTunnelTaskProvider(cli, auth, outputChannel)
        )
    );

    // Register status bar command
    context.subscriptions.push(
        vscode.commands.registerCommand('devtunnels.showVersionStatus', async () => {
            const result = await statusBar.check();

            if (!result.installed) {
                const action = await vscode.window.showWarningMessage(
                    'Dev Tunnels CLI is not installed.',
                    'Install'
                );
                if (action === 'Install') {
                    await cli.install();
                }
                return;
            }

            if (result.updateAvailable) {
                const action = await vscode.window.showWarningMessage(
                    `Dev Tunnels CLI update available: v${result.version} → v${result.latest}`,
                    'Update'
                );
                if (action === 'Update') {
                    await cli.upgrade();
                }
            } else {
                vscode.window.showInformationMessage(`Dev Tunnels CLI v${result.version} is up to date.`);
            }
        })
    );

    context.subscriptions.push(statusBar, outputChannel, auth);

    // Activation checks
    activationChecks(cli, statusBar);
}

async function activationChecks(cli: DevTunnelsCli, statusBar: StatusBar): Promise<void> {
    const result = await statusBar.check();

    if (!result.installed) {
        const action = await vscode.window.showWarningMessage(
            'Dev Tunnels CLI not found. Install it to get started.',
            'Install'
        );
        if (action === 'Install') {
            await cli.install();
        }
        return;
    }

    if (result.updateAvailable) {
        const action = await vscode.window.showInformationMessage(
            `Dev Tunnels CLI update available: v${result.version} → v${result.latest}. Update now?`,
            'Yes',
            'No'
        );
        if (action === 'Yes') {
            await cli.upgrade();
        }
    }
}

export function deactivate() {}
