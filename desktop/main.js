/* TEMPLE LAPSAI, AS A DESKTOP APP. The game is a browser game with a tiny local
 * server behind it; this wraps both in one window, so it installs and runs like
 * any other app — no Node prerequisite, no separate browser.
 *
 * It launches the same server.js the launcher bundles use, on 127.0.0.1, then
 * points a window at it, and takes the server down with the window.
 */

import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const URL = `http://127.0.0.1:${PORT}/`;

let server = null;
let win = null;
let quitting = false;

function startServer() {
  /* The Electron binary is a Node runtime when asked to be; run the very same
   * server the launcher bundles run, so there is one server to keep working. */
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  server.on('exit', (code) => {
    if (!quitting && code) console.error('[server] exited with code ' + code);
  });
}

function waitForServer(timeoutMs = 15000) {
  const began = Date.now();
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get(URL, (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - began > timeoutMs) resolve(false);
        else setTimeout(ping, 200);
      });
    };
    ping();
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0a0a08',
    title: 'Temple Lapsai',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const up = await waitForServer();
  if (!up) {
    win.loadURL('data:text/html,<body style="background:%230a0a08;color:%23b88a3a;font:14px monospace;padding:2em">The local game server did not come up. Try closing and reopening Temple Lapsai.</body>');
    return;
  }
  win.loadURL(URL);
  win.on('closed', () => { win = null; });
}

function stopServer() {
  quitting = true;
  if (server && !server.killed) server.kill();
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { stopServer(); app.quit(); });
app.on('before-quit', stopServer);
