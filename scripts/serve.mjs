/* THE DETACHED SERVER. Measured, twice: the game server dies to SIGTERM
 * from a session-scoped supervisor — once while the machine was wide
 * awake, thirty minutes before the lid ever closed. Nothing is wrong with
 * server.js; it is simply somebody else's child. This starts a copy that
 * belongs to NOBODY: its own process group, stdio to a file, unref'd, so
 * closing a terminal, a pane or a whole session leaves it serving.
 *
 *   npm run serve          start it (or report the one already up)
 *   npm run serve:status   is it alive, and since when
 *   npm run serve:stop     stop it deliberately — the only way it dies
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PID_FILE = path.join(ROOT, '.server.pid');
const OUT_LOG = path.join(ROOT, 'server-out.log');
const PORT = process.env.PORT || 8080;

function running(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid() {
  try { return Number(fs.readFileSync(PID_FILE, 'utf8').trim()) || null; } catch { return null; }
}

function start() {
  const existing = readPid();
  if (running(existing)) {
    console.log(`Already serving on http://localhost:${PORT} (pid ${existing}).`);
    return;
  }
  const out = fs.openSync(OUT_LOG, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    detached: true,        /* its own process group: no shared signals */
    stdio: ['ignore', out, out],
    env: { ...process.env, PORT: String(PORT) },
  });
  child.unref();           /* this launcher may exit; the server may not */
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Serving on http://localhost:${PORT} (pid ${child.pid}), detached.`);
  console.log(`  output: ${path.relative(ROOT, OUT_LOG)}   events: server-events.log`);
  console.log('  stop it with: npm run serve:stop');
}

function stop() {
  const pid = readPid();
  if (!running(pid)) {
    console.log('Nothing to stop.');
    try { fs.unlinkSync(PID_FILE); } catch { /* never was */ }
    return;
  }
  process.kill(pid, 'SIGTERM');
  fs.unlinkSync(PID_FILE);
  console.log(`Stopped the server (pid ${pid}).`);
}

function status() {
  const pid = readPid();
  if (!running(pid)) { console.log('Not running.'); return; }
  console.log(`Running: pid ${pid} on http://localhost:${PORT}.`);
  try {
    const tail = fs.readFileSync(path.join(ROOT, 'server-events.log'), 'utf8').trim().split('\n').slice(-3);
    for (const l of tail) console.log('  ' + l);
  } catch { /* no log yet */ }
}

const cmd = process.argv[2] || 'start';
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else if (cmd === 'status') status();
else { console.error('usage: serve.mjs start|stop|status'); process.exit(1); }
