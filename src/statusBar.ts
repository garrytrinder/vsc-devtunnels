import * as vscode from 'vscode';
import { DevTunnelsCli } from './cli';
import { isOlderVersion } from './utils';

export interface StatusCheckResult {
    installed: boolean;
    version?: string;
    latest?: string;
    updateAvailable: boolean;
}

export class StatusBar {
    private item: vscode.StatusBarItem;
    private cli: DevTunnelsCli;

    constructor(cli: DevTunnelsCli) {
        this.cli = cli;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.item.command = 'devtunnels.showVersionStatus';
        this.item.name = 'Dev Tunnels';
    }

    async check(): Promise<StatusCheckResult> {
        const installed = await this.cli.isInstalled();

        if (!installed) {
            this.showNotInstalled();
            return { installed: false, updateAvailable: false };
        }

        const version = await this.cli.getVersion();
        const latest = await this.cli.getLatestVersion();
        const updateAvailable = !!latest && isOlderVersion(version, latest);

        if (updateAvailable) {
            this.showOutdated(version, latest!);
        } else {
            this.showCurrent(version);
        }

        return { installed: true, version, latest: latest ?? undefined, updateAvailable };
    }

    private showNotInstalled(): void {
        this.item.text = '$(error) Dev Tunnels: Not installed';
        this.item.tooltip = 'Click to install the Dev Tunnels CLI';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.show();
    }

    private showCurrent(version: string): void {
        this.item.text = `$(radio-tower) Dev Tunnels: v${version}`;
        this.item.tooltip = 'Dev Tunnels CLI is up to date';
        this.item.backgroundColor = undefined;
        this.item.show();
    }

    private showOutdated(version: string, latest: string): void {
        this.item.text = `$(warning) Dev Tunnels: v${version} → v${latest}`;
        this.item.tooltip = 'Update available — click to upgrade';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}
