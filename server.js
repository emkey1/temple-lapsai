import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, extractJSON, validateExpansion } from './lib/expansion.js';

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

const CONFIG = {
  apiKey: process.env.OPENAI_API_KEY || '',
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
};

try {
  const cfgPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    CONFIG.apiKey = CONFIG.apiKey || (fileCfg.openai && fileCfg.openai.apiKey) || fileCfg.apiKey || CONFIG.apiKey;
    CONFIG.baseUrl = CONFIG.baseUrl || (fileCfg.openai && fileCfg.openai.baseUrl) || fileCfg.baseUrl || CONFIG.baseUrl;
    CONFIG.model = CONFIG.model || (fileCfg.openai && fileCfg.openai.model) || fileCfg.model || CONFIG.model;
  }
} catch (err) {
  console.warn('[expand-server] Could not read config.json (optional):', err.message);
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

async function callLLM(prompt) {
  if (!CONFIG.apiKey) {
    const err = new Error('No LLM API key configured');
    err.code = 'NO_KEY';
    throw err;
  }
  const body = {
    model: CONFIG.model,
    messages: [
      { role: 'system', content: 'You are a creative content designer for a classic D&D-style dungeon crawler. Always reply with strict JSON only.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.9,
  };
  const res = await fetch(`${CONFIG.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CONFIG.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    const err = new Error(`LLM request failed (${res.status}): ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!text) { const e = new Error('LLM returned empty content'); e.code = 'EMPTY'; throw e; }
  return text;
}

async function handleExpand(action, context) {
  const prompt = buildPrompt(action, context);
  const text = await callLLM(prompt);
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
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
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
        llmConfigured: Boolean(CONFIG.apiKey),
        model: CONFIG.model,
        baseUrl: CONFIG.baseUrl,
        expansions: readExpansions().length,
      });
    }

    if (req.method === 'GET' && pathname === '/api/expansions') {
      return sendJSON(res, 200, readExpansions());
    }

    if (req.method === 'POST' && pathname === '/api/expand') {
      const body = await readBody(req);
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

server.listen(PORT, () => {
  const llm = CONFIG.apiKey ? `${CONFIG.model} @ ${CONFIG.baseUrl}` : 'NOT CONFIGURED (set OPENAI_API_KEY)';
  console.log(`Temple of Lapsai server on http://localhost:${PORT}`);
  console.log(`  LLM: ${llm}`);
  console.log(`  Expansions: ${EXPANSIONS_FILE}`);
});
