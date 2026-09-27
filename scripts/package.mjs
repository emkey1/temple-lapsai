/* PACKAGE THE GAME AS A DOWNLOAD. Builds one zip per platform, each holding the
 * game plus a double-clickable launcher, so a player can download, unzip, and
 * run — no build step, no install beyond Node itself.
 *
 *   node scripts/package.mjs        # writes dist/temple-lapsai-<version>-<os>.zip
 *
 * The desktop app (Electron) is a separate build; see desktop/ and
 * .github/workflows/release.yml. This is the lightweight path that keeps the
 * repo's zero-dependency promise at runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LAUNCH = path.join(__dirname, 'launch');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const APP = `TempleLapsai-${VERSION}`;

/* What every bundle carries; the launcher is added per platform. */
const SHARED = ['server.js', 'package.json', 'README.md', 'PLAYING.md', 'LICENSE'];
const SHARED_DIRS = ['public', 'lib'];

const PLATFORMS = [
  { os: 'macos', launcher: 'macos.command', name: 'Start Temple Lapsai.command', executable: true, click: 'double-click' },
  { os: 'windows', launcher: 'windows.bat', name: 'Start Temple Lapsai.bat', executable: false, click: 'double-click' },
  { os: 'linux', launcher: 'linux.sh', name: 'start-temple-lapsai.sh', executable: true, click: 'run: ./start-temple-lapsai.sh' },
];

const howto = `TEMPLE LAPSAI ${VERSION}
============================

A turn-based party dungeon crawler for the browser.

TO PLAY
  1. Install Node.js (the LTS build) if you do not already have it:
     https://nodejs.org
  2. Double-click the launcher for your machine, in this folder:
       macOS    Start Temple Lapsai.command
       Windows  Start Temple Lapsai.bat
       Linux    start-temple-lapsai.sh   (run it in a terminal)
  3. A terminal window opens and your browser opens to the game. Playing is
     in the browser; the launcher is just the little server behind it.
  4. To stop, close the terminal window (or press Ctrl-C in it).

Everything is offline and self-contained: saves live in your browser, and no
account or API key is needed. The optional Black Library (LLM-written content)
can be bound from inside the game if you want it.

Full manual: PLAYING.md    How it is built: README.md
`;

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
function copyInto(stage, rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(stage, rel);
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !JUNK.has(path.basename(src)),
  });
}

function build() {
  const stageRoot = path.join(DIST, 'stage');
  const stage = path.join(stageRoot, APP);
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  for (const f of SHARED) fs.copyFileSync(path.join(ROOT, f), path.join(stage, f));
  for (const d of SHARED_DIRS) copyInto(stage, d);

  /* One bundle for every platform: the app is identical, only the launcher
   * differs, and the art does not compress — three near-identical 76 MB assets
   * would cost three times the disk for no benefit to anyone downloading one. */
  for (const platform of PLATFORMS) {
    const dst = path.join(stage, platform.name);
    fs.copyFileSync(path.join(LAUNCH, platform.launcher), dst);
    if (platform.executable) fs.chmodSync(dst, 0o755);
  }

  fs.writeFileSync(path.join(stage, 'HOW TO PLAY.txt'), howto);

  const zip = path.join(DIST, `temple-lapsai-${VERSION}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-r', '-q', zip, APP], { cwd: stageRoot });
  fs.rmSync(stageRoot, { recursive: true, force: true });
  return zip;
}

function main() {
  if (!fs.existsSync(LAUNCH)) {
    console.error('missing launcher templates at ' + LAUNCH);
    process.exit(1);
  }
  fs.mkdirSync(DIST, { recursive: true });
  try {
    const zip = build();
    const mb = (fs.statSync(zip).size / (1024 * 1024)).toFixed(1);
    console.log(`built ${path.basename(zip)}  (${mb} MB) in ${DIST}`);
  } catch (err) {
    console.error('packaging failed: ' + err.message);
    console.error('(the "zip" command must be on PATH)');
    process.exit(1);
  }
}

main();
