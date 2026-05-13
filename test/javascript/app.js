const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

function readEnv() {
  const envPath = path.join(__dirname, '.env');
  const vars = {};
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        vars[match[1].trim()] = match[2].trim();
      }
    }
  } catch {
    // .env not created yet
  }
  return vars;
}

app.get('/', (req, res) => {
  const env = readEnv();
  const tunnelUrl = env.DEVTUNNEL_URL || 'not set';

  res.send(`
    <html>
      <head>
        <title>Dev Tunnels Test</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 60px auto; color: #333; }
          h1 { color: #0078d4; }
          dt { font-weight: bold; margin-top: 12px; }
          dd { margin: 4px 0 0 0; font-family: monospace; background: #f4f4f4; padding: 6px 10px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Dev Tunnels Test App</h1>
        <p>Running on port ${PORT}</p>
        <dl>
          <dt>Tunnel URL</dt>
          <dd>${tunnelUrl}</dd>
        </dl>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
