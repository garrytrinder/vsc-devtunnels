# Dev Tunnels for VS Code

Expose local ports to the internet during debugging with full F5 integration.

## Quick Start

Add a task to `.vscode/tasks.json`:

```json
{
  "label": "Start Tunnel",
  "type": "devtunnel",
  "port": 3000,
  "isBackground": true,
  "problemMatcher": "$devtunnel-host"
}
```

Reference it in `.vscode/launch.json`:

```json
{
  "name": "Debug",
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/app.js",
  "preLaunchTask": "Start Tunnel",
  "postDebugTask": "Stop Tunnel"
}
```

Add a stop task:

```json
{
  "label": "Stop Tunnel",
  "type": "devtunnel",
  "operation": "stop"
}
```

Press F5. The tunnel starts, your app launches, and you get a public URL. Stop debugging, the tunnel stops.

See the [test/](test/) folder for working sample applications (.NET and JavaScript) with pre-configured tasks and launch configs.

## How It Works

- On activation, checks for the `devtunnel` CLI — prompts to install if missing, prompts to upgrade if outdated
- Installs/upgrades using the OS package manager (`brew` on macOS, `winget` on Windows, install script on Linux)
- Authenticates via GitHub or Microsoft (prompts on first use)
- Creates a tunnel, forwards your port, and writes the URL to your env file
- Tears down on stop

The status bar shows the CLI status at a glance: installed version, update available, or not installed.

## What's Included

| Contribution | Name | Description |
|--------------|------|-------------|
| Task Provider | `devtunnel` | Host and stop tunnels as VS Code tasks |
| Problem Matcher | `$devtunnel-host` | Detects when the tunnel is ready so dependant tasks can proceed |
| Command | `Dev Tunnels: Show Version Status` | Shows CLI version and auth status in the status bar |
| Settings | `devtunnels.cliPath`, `devtunnels.authMethod` | Configure CLI path and authentication method |

## Temporary Tunnels

The default. A new tunnel is created each debug session and discarded on stop. No setup, no leftover resources.

```json
{
  "label": "Start Tunnel",
  "type": "devtunnel",
  "port": 3000,
  "isBackground": true,
  "problemMatcher": "$devtunnel-host"
}
```

## Persistent Tunnels

A named tunnel that survives across sessions. Same URL every time, ideal for webhook endpoints or sharing with teammates. Tunnels expire after 30 days by default — override with `expiration`.

```json
{
  "label": "Start Tunnel",
  "type": "devtunnel",
  "tunnelType": "persistent",
  "tunnelId": "my-api",
  "port": 3000,
  "access": "anonymous",
  "expiration": "7d",
  "isBackground": true,
  "problemMatcher": "$devtunnel-host"
}
```

The extension creates the tunnel if it doesn't exist, adds the port, and configures access automatically.

To stop a specific persistent tunnel, include `tunnelId` in the stop task:

```json
{
  "label": "Stop Tunnel",
  "type": "devtunnel",
  "operation": "stop",
  "tunnelId": "my-api"
}
```

Omitting `tunnelId` from a stop task stops all running tunnels.

## Writing the Tunnel URL to Your App

Set `envFilePath` to write the tunnel URL into an existing file:

```json
{
  "label": "Start Tunnel",
  "type": "devtunnel",
  "port": 3000,
  "envFilePath": ".env",
  "isBackground": true,
  "problemMatcher": "$devtunnel-host"
}
```

Supported formats (detected from file extension):

| Extension | Format | Output |
|-----------|--------|--------|
| `.env`, `.env.*` | dotenv | `DEVTUNNEL_URL=https://...` |
| `.json` | JSON | `{ "DevTunnelUrl": "https://..." }` |

The variable name defaults to `DEVTUNNEL_URL` for dotenv and `DevTunnelUrl` for JSON. Override it with `envUrlVariable`:

```json
"envFilePath": "appsettings.Development.json",
"envUrlVariable": "TunnelUrl"
```

Values are merged into existing file content — nothing else is overwritten.

## Access Control

By default, only you can access the tunnel (requires authentication). Open it up when you need to:

| Value | Who can connect |
|-------|-----------------|
| *(omitted)* | Only you (authenticated) |
| `"anonymous"` | Anyone with the URL |
| `"tenant"` | Anyone in your Entra ID tenant |
| `{ "org": "name" }` | Members of a GitHub organization |

```json
"access": "anonymous"
```

## Task Reference

### Host (default operation)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `port` | `number` | — | Port to forward |
| `tunnelType` | `"temporary"` \| `"persistent"` | `"temporary"` | Tunnel lifecycle |
| `tunnelId` | `string` | — | Tunnel ID (required for persistent) |
| `access` | `"anonymous"` \| `"tenant"` \| `{ "org": "..." }` | authenticated only | Access control |
| `protocol` | `"auto"` \| `"http"` \| `"https"` | `"auto"` | Port protocol |
| `expiration` | `"1h"` `"2h"` `"4h"` `"8h"` `"1d"` `"2d"` `"7d"` `"14d"` `"30d"` | — | Tunnel expiration |
| `description` | `string` | — | Tunnel description |
| `labels` | `string[]` | — | Searchable labels |
| `hostHeader` | `string` | — | Host header rewrite (`"unchanged"` to keep original) |
| `originHeader` | `string` | — | Origin header rewrite (`"unchanged"` to keep original) |
| `requestTimeout` | `number` | — | Timeout (seconds) for forwarded requests. `0` to disable |
| `envFilePath` | `string` | — | Path to write tunnel URL to (`.env` or `.json`) |
| `envUrlVariable` | `string` | `"DEVTUNNEL_URL"` (dotenv) / `"DevTunnelUrl"` (json) | Variable name for the URL |

### Stop

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `operation` | `"stop"` | — | **Required** for stop tasks |
| `tunnelId` | `string` | — | Stop a specific tunnel (omit to stop all) |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `devtunnels.cliPath` | `"devtunnel"` | Path to the CLI executable |
| `devtunnels.authMethod` | `"browser"` \| `"deviceCode"` | Authentication method |

## Requirements

- [Dev Tunnels CLI](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started)
- A GitHub or Microsoft account
