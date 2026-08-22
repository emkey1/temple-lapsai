import { spawn, execSync } from 'node:child_process';
import { writeFileSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const log = path.join(root, 'server.log');
const port = Number(process.env.PORT || 8080);

/* Actually write the log this script tells you about: it used to spawn with
 * stdio ignored and then print "Server logs to server.log", which only ever
 * contained pid lines. */
const logFd = openSync(log, 'a');
const server = spawn(process.execPath, [path.join(root, 'server.js')], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: { ...process.env, PORT: String(port) },
});
writeFileSync(log, `\n--- spawned pid ${server.pid} at ${new Date().toISOString()} ---\n`, { flag: 'a' });
server.unref();

const deadline = Date.now() + 15000;
let up = false;
while (Date.now() < deadline) {
  try {
    /* 127.0.0.1, not localhost: the server binds IPv4-only by default, and
     * `localhost` resolves to ::1 first on most hosts. Node 20+ retries the
     * other family, Node 18 does not — and the README promises Node 18. */
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (res.ok) { up = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const url = `http://127.0.0.1:${port}`;
if (up) {
  try { execSync(`open -a Safari '${url}'`); }
  catch { execSync(`open '${url}'`); }
  console.log(`Game is running: ${url} (opening Safari)`);
  console.log(`Server logs to ${log} · stop it with: kill ${server.pid}`);
} else {
  console.error(`Server did not answer on 127.0.0.1:${port} within 15s. It may still be running — see ${log}, and check whether the port is already in use.`);
  process.exit(1);
}
