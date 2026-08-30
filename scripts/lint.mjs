/* A lint with no dependencies, because "no npm install required" is a promise
 * this project makes in its README and an eslint devDependency would break it.
 *
 * Checks what actually goes wrong in a codebase like this one: files that do
 * not parse, imports that point at nothing, debris left behind after a debug
 * session, and the two conventions the game's own content depends on.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['node_modules', '.git', '.claude']);

function jsFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (/\.(m?js)$/.test(name)) out.push(full);
  }
  return out;
}

const problems = [];
const rel = (f) => path.relative(ROOT, f);

function report(file, line, msg) {
  problems.push(`${rel(file)}${line ? ':' + line : ''}  ${msg}`);
}

const files = jsFiles();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');

  // 1. It has to parse.
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    report(file, null, 'does not parse: ' + String(err.stderr || err).split('\n').slice(0, 2).join(' ').trim());
    continue;
  }

  // 2. Relative imports have to point at a file that exists. A typo here fails
  //    silently in the browser and takes the whole module graph with it.
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!existsSync(target)) {
      const line = src.slice(0, m.index).split('\n').length;
      report(file, line, `imports '${m[1]}', which does not exist`);
    }
  }

  lines.forEach((text, i) => {
    const n = i + 1;
    // 3. Debug debris.
    if (/^\s*debugger\b/.test(text)) report(file, n, 'debugger statement left in');
    if (/\bconsole\.log\(/.test(text) && file.includes(`${path.sep}public${path.sep}`)) {
      report(file, n, 'console.log in client code — use the in-game log');
    }
    // 4. Tabs, in a file set that is spaces throughout.
    if (/^\t/.test(text)) report(file, n, 'indented with a tab');
    // 5. Trailing whitespace.
    if (/[ \t]+$/.test(text)) report(file, n, 'trailing whitespace');
  });

  if (src.length && !src.endsWith('\n')) report(file, null, 'no trailing newline');
}

/* 6. The two conventions the content depends on. Both of these have already
 *    broken the game once. */
const lore = path.join(ROOT, 'public', 'js', 'lore.js');
if (existsSync(lore)) {
  const src = readFileSync(lore, 'utf8');
  src.split('\n').forEach((text, i) => {
    // A straight apostrophe inside a single-quoted literal ends it early.
    if (/'[^']*\w'\w/.test(text)) report(lore, i + 1, 'straight apostrophe inside a single-quoted string');
  });
}

const contract = path.join(ROOT, 'public', 'js', 'contract.js');
const server = path.join(ROOT, 'lib', 'expansion.js');
if (existsSync(contract) && existsSync(server)) {
  const s = readFileSync(server, 'utf8');
  // The validator must take its vocabulary from the contract, not redefine it.
  if (/const\s+(ITEM_KINDS|MONSTER_PROPS|DUNGEON_THEMES|ABILITY_KINDS)\s*=\s*\[/.test(s)) {
    report(server, null, 'redefines a vocabulary that belongs to contract.js');
  }
}

/* 7. THE ORACLE'S BINDING NEVER GOES IN THE REPO.
 *
 * config.json holds the endpoint and, for a hosted provider, an API key. It
 * is in .gitignore, which is necessary and not sufficient: `git add -f` beats
 * an ignore file, and a file that was tracked BEFORE being ignored stays
 * tracked for ever. Both mistakes are silent and both are unfixable after a
 * push — a key in a public history is a key that has to be rotated, not
 * deleted. So the check is against git's own index rather than against the
 * ignore rules, and it runs on every `npm run check`. */
try {
  const tracked = execFileSync('git', ['ls-files', 'config.json'], { cwd: ROOT, stdio: 'pipe' })
    .toString().trim();
  if (tracked) {
    report(path.join(ROOT, 'config.json'), null,
      'is TRACKED by git — it holds the oracle endpoint and key. `git rm --cached config.json`');
  }
} catch { /* not a git checkout, or no git: nothing to check */ }

/* And nothing that IS tracked may carry a bound key: the oracle records one
 * as a JSON string field, and a non-empty value in a tracked file is a
 * credential heading for a push. (This comment is deliberately free of the
 * shape it describes — the first draft flagged the linter twice over.) */
for (const file of [...files, ...['config.json', 'data/expansions.json'].map((f) => path.join(ROOT, f))]) {
  if (!existsSync(file)) continue;
  let tracked = true;
  try {
    tracked = Boolean(execFileSync('git', ['ls-files', path.relative(ROOT, file)], { cwd: ROOT, stdio: 'pipe' })
      .toString().trim());
  } catch { /* assume tracked, and check anyway */ }
  if (!tracked) continue;
  const src = readFileSync(file, 'utf8');
  /* The key name is split so that this rule cannot match its own source —
   * the first draft flagged the linter itself, which is funny once. */
  const m = src.match(/["'](?:api)(?:Key)["']\s*:\s*["']([^"']+)["']/);
  if (m) report(file, src.slice(0, m.index).split('\n').length, 'a tracked file carries a bound key');
}

if (problems.length) {
  console.error(`lint: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`lint: ${files.length} files, no problems`);
