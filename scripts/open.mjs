import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const log = path.join(root, 'server.log');
const port = Number(process.env.PORT || 8080);

const server = spawn(process.execPath, [path.join(root, 'server.js')], {
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, PORT: String(port) },
});
writeFileSync(log, `spawned pid ${server.pid}\n`, { flag: 'a' });
server.unref();

const deadline = Date.now() + 15000;
let up = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    if (res.ok) { up = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const url = `http://localhost:${port}`;
if (up) {
  try { execSync(`open -a Safari '${url}'`); }
  catch { execSync(`open '${url}'`); }
  console.log(`Game is running: ${url} (opening Safari)`);
  console.log(`Server logs to ${log} · stop it with: kill ${server.pid}`);
} else {
  console.error(`Server did not come up; is port ${port} already in use? log: ${log}`);
  process.exit(1);
}
