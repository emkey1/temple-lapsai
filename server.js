import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, extractJSON, validateExpansion } from './lib/expansion.js';
import {
  loadOracle, writeOracle, describeOracle, applySettings, callOracle, probeOracle,
} from './lib/oracle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const EXPANSIONS_FILE = path.join(DATA_DIR, 'expansions.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const PORT = process.env.PORT || 8080;
const CONFIG_PATH = path.join(__dirname, 'config.json');

/* Who the oracle is, and whether it has anything to prove itself with. Held in
 * one place so the Black Library can rebind it at runtime — the whole reason
 * this used to need a restart is that the answer was frozen at import. */
let oracle = loadOracle(CONFIG_PATH);

function oracleReadyNow() {
  return describeOracle(oracle).ready;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EXPANSIONS_FILE)) {
  fs.writeFileSync(EXPANSIONS_FILE, '[]');
}

function readExpansions() {
  try {
    const list = JSON.parse(fs.readFileSync(EXPANSIONS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* Appends are serialised: two expansions generated at once were a
 * read-modify-write race that silently dropped one of them. */
let writeQueue = Promise.resolve();

function appendExpansion(expansion) {
  writeQueue = writeQueue.then(() => {
    const list = readExpansions();
    expansion.id = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    expansion.installedAt = new Date().toISOString();
    list.push(expansion);
    fs.writeFileSync(EXPANSIONS_FILE, JSON.stringify(list, null, 2));
  }).catch((err) => {
    console.error('[expand-server] could not save expansion:', err.message);
  });
  return writeQueue.then(() => expansion);
}

async function handleExpand(action, context) {
  const prompt = buildPrompt(action, context);
  const text = await callOracle(oracle, prompt);
  const parsed = extractJSON(text);
  const expansion = validateExpansion(parsed);
  return await appendExpansion(expansion);
}

/* ------------------------------------------------------------------ *
 *  HTTP server
 * ------------------------------------------------------------------ */

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* The game is served from this origin, so nothing legitimate is cross-origin.
 * `Access-Control-Allow-Origin: *` on /api/expand meant any page you happened
 * to visit could drive your API key in a loop.
 *
 * Gate on the SERVER's identity, not on headers the caller chose. Comparing
 * Origin against Host passes any request whose two headers agree — which is
 * exactly the shape of DNS rebinding, where a hostile page resolves its own
 * domain to 127.0.0.1 and the browser sends both honestly. */
function allowedAuthorities() {
  return new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
}

function sameOrigin(req) {
  const allowed = allowedAuthorities();
  /* Rebinding dies here: the Host the client used has to be one of ours. */
  if (!allowed.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;   /* non-browser clients; browsers always send it on POST */
  try {
    return allowed.has(new URL(origin).host);
  } catch {
    return false;
  }
}

/* Requiring JSON forces a preflight this server never answers, which closes
 * the `mode:'no-cors'` text/plain POST that needs no preflight at all. */
function isJson(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json');
}

/* A local single-player server has no business being a shared LLM gateway. */
const EXPAND_WINDOW_MS = 60_000;
const EXPAND_MAX = 12;
const expandHits = [];

function rateLimited() {
  const now = Date.now();
  while (expandHits.length && now - expandHits[0] > EXPAND_WINDOW_MS) expandHits.shift();
  if (expandHits.length >= EXPAND_MAX) return true;
  expandHits.push(now);
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function staticServe(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '/index.html') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(301, { Location: pathname.replace(/\/?$/, '/') + 'index.html' }); res.end(); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. This is the dungeon of broken links.');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/api/status')) {
      return sendJSON(res, 200, {
        ok: true,
        llmConfigured: oracleReadyNow(),
        provider: oracle.settings.provider,
        model: oracle.settings.model,
        baseUrl: oracle.settings.baseUrl,
        expansions: readExpansions().length,
      });
    }

    /* The Black Library's own settings. Everything that mutates them is held
     * to the same origin and content-type rules as /api/expand, because a
     * drive-by that could repoint the endpoint could also read the key back
     * out of the next request the server makes. */
    if (req.method === 'GET' && pathname === '/api/oracle') {
      return sendJSON(res, 200, describeOracle(oracle));
    }

    if (req.method === 'POST' && (pathname === '/api/oracle' || pathname === '/api/oracle/test')) {
      if (!sameOrigin(req)) return sendJSON(res, 403, { error: 'cross-origin requests are not accepted' });
      if (!isJson(req)) return sendJSON(res, 415, { error: 'send application/json' });
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJSON(res, 400, { error: 'could not read that request: ' + (err.message || 'bad JSON') });
      }

      if (pathname === '/api/oracle/test') {
        /* A test is a real call, so it comes out of the same budget. */
        if (rateLimited()) return sendJSON(res, 429, { error: 'the scribes need a moment — try again shortly' });
        try {
          const reply = await probeOracle(oracle);
          return sendJSON(res, 200, { ok: true, model: oracle.settings.model, reply });
        } catch (err) {
          return sendJSON(res, 200, { ok: false, error: err.message || 'the oracle did not answer' });
        }
      }

      /* FORGET: drop the saved block and fall back to whatever the environment
       * says, so a player can undo a menu choice without editing JSON. */
      if (body.reset === true) {
        writeOracle(CONFIG_PATH, null);
        oracle = loadOracle(CONFIG_PATH);
        return sendJSON(res, 200, describeOracle(oracle));
      }

      const next = applySettings(oracle, body);
      writeOracle(CONFIG_PATH, next.settings, next.apiKey);
      oracle = next;
      console.log(`[oracle] bound to ${oracle.settings.provider} · ${oracle.settings.model}`);
      return sendJSON(res, 200, describeOracle(oracle));
    }

    if (req.method === 'GET' && pathname === '/api/expansions') {
      return sendJSON(res, 200, readExpansions());
    }

    if (req.method === 'POST' && pathname === '/api/expand') {
      if (!sameOrigin(req)) return sendJSON(res, 403, { error: 'cross-origin requests are not accepted' });
      if (!isJson(req)) return sendJSON(res, 415, { error: 'send application/json' });
      /* Check the key BEFORE spending the budget: a 429 that hides "no key
       * configured" sends you looking for the wrong problem. */
      if (!oracleReadyNow()) return sendJSON(res, 503, { error: 'No oracle is bound — choose one in the Black Library' });
      if (rateLimited()) return sendJSON(res, 429, { error: 'the scribes need a moment — try again shortly' });
      let body;
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJSON(res, 400, { error: 'could not read that request: ' + (err.message || 'bad JSON') });
      }
      const action = ['dungeon', 'monster', 'item', 'ability'].includes(body.action) ? body.action : 'item';
      const expansion = await handleExpand(action, body.context || {});
      return sendJSON(res, 201, { ok: true, expansion });
    }

    if (pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'unknown api route' });
    }

    return staticServe(req, res, pathname);
  } catch (err) {
    const status = err.status || (err.code === 'NO_KEY' ? 503 : 500);
    console.error('[expand-server] error:', err.message);
    return sendJSON(res, status, { error: err.message || 'internal error' });
  }
});

/* Loopback by default: this serves a single player on their own machine.
 * Set HOST=0.0.0.0 deliberately if you want it on the network. */
const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  const llm = oracleReadyNow()
    ? `${oracle.settings.provider} · ${oracle.settings.model} @ ${oracle.settings.baseUrl} (${oracle.source})`
    : 'NOT BOUND — pick a provider in the Black Library, in game';
  console.log(`Temple Lapsai server on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  LLM: ${llm}`);
  console.log(`  Expansions: ${EXPANSIONS_FILE}`);
});
