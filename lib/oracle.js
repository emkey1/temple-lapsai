/* THE ORACLE: which model answers the Black Library, and how to reach it.
 *
 * Split from server.js for the same reason expansion.js was — everything here
 * that decides something is a pure function, so the whole of it can be tested
 * without a socket or an API key. Only callOracle touches the network.
 *
 * The provider list lives in public/js/providers.js so the browser menu and
 * this validator are reading the same file: the menu cannot offer an endpoint
 * the server has no dialect for.
 */

import fs from 'node:fs';
import { PROVIDERS, providerById, resolveOracle, trimSlash, oracleReady } from '../public/js/providers.js';

const ANTHROPIC_VERSION = '2023-06-01';
const SYSTEM_PROMPT = 'You are a creative content designer for a classic D&D-style dungeon crawler. Always reply with strict JSON only.';

/* ------------------------------------------------------------------ *
 *  Settings: where they come from, and how they are written back
 * ------------------------------------------------------------------ */

/* Precedence is saved-then-environment, and the client is told which one it
 * got. The player who picks a provider from the menu has said something more
 * deliberate than whoever exported a variable in a shell profile — but a
 * variable they never overrode still works untouched, and FORGET puts them
 * back to it. */
export function loadOracle(configPath, env = process.env) {
  const file = readConfigFile(configPath);
  const saved = file && typeof file.oracle === 'object' ? file.oracle : null;

  if (saved && (saved.apiKey || saved.provider || saved.baseUrl || saved.model)) {
    return {
      settings: resolveOracle(saved),
      apiKey: String(saved.apiKey || '').trim(),
      source: 'saved',
    };
  }

  const fromEnv = oracleFromEnv(env, file);
  if (fromEnv) return fromEnv;

  return { settings: resolveOracle({}), apiKey: '', source: 'unset' };
}

/* The variables the README has always documented keep working, plus the two
 * obvious extras. A bare ANTHROPIC_API_KEY is enough to pick the provider —
 * nobody should have to also name the dialect they clearly meant. */
function oracleFromEnv(env, file) {
  const legacy = legacyFileConfig(file);
  const generic = String(env.ORACLE_API_KEY || '').trim();
  const openai = String(env.OPENAI_API_KEY || '').trim() || legacy.apiKey;
  const anthropic = String(env.ANTHROPIC_API_KEY || '').trim();

  let provider = env.ORACLE_PROVIDER;
  let apiKey = generic;
  if (!provider) {
    if (openai) provider = 'openai';
    else if (anthropic) provider = 'anthropic';
  }
  if (!apiKey) apiKey = provider === 'anthropic' ? anthropic : openai;
  if (!provider && !apiKey) return null;
  if (!providerById(provider)) provider = openai ? 'openai' : 'anthropic';

  const settings = resolveOracle({
    provider,
    baseUrl: env.ORACLE_BASE_URL || env.OPENAI_BASE_URL || legacy.baseUrl,
    model: env.ORACLE_MODEL || env.OPENAI_MODEL || env.ANTHROPIC_MODEL || legacy.model,
  });
  return { settings, apiKey, source: 'environment' };
}

/* config.json used to be {apiKey,baseUrl,model} or {openai:{…}}. Both still
 * read, so nobody's existing file stops working. */
function legacyFileConfig(file) {
  if (!file || typeof file !== 'object') return {};
  const o = file.openai && typeof file.openai === 'object' ? file.openai : {};
  return {
    apiKey: String(o.apiKey || file.apiKey || '').trim(),
    baseUrl: String(o.baseUrl || file.baseUrl || '').trim(),
    model: String(o.model || file.model || '').trim(),
  };
}

export function readConfigFile(configPath) {
  try {
    if (!fs.existsSync(configPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/* Whatever else is in config.json stays in config.json. */
export function writeOracle(configPath, settings, apiKey) {
  const file = readConfigFile(configPath) || {};
  if (settings === null) delete file.oracle;
  else file.oracle = { ...settings, apiKey: apiKey || '' };
  fs.writeFileSync(configPath, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(configPath, 0o600); } catch { /* best effort on odd filesystems */ }
  return file;
}

/* ------------------------------------------------------------------ *
 *  What the client is allowed to know
 * ------------------------------------------------------------------ */

/* The key never comes back out. The last four characters do, because
 * "is that the key I think it is" is the question this panel exists to
 * answer, and four characters cannot be replayed as a credential. */
export function keyHint(apiKey) {
  const k = String(apiKey || '');
  if (!k) return '';
  return k.length <= 4 ? '…' + k : '…' + k.slice(-4);
}

export function describeOracle(state) {
  const p = providerById(state.settings.provider);
  return {
    providers: PROVIDERS.map((x) => ({
      id: x.id, label: x.label, dialect: x.dialect, baseUrl: x.baseUrl,
      models: x.models, keyRequired: x.keyRequired !== false, keyHint: x.keyHint,
      custom: x.custom === true,
    })),
    current: {
      ...state.settings,
      label: p ? p.label : state.settings.provider,
      keyRequired: p ? p.keyRequired !== false : true,
      hasKey: Boolean(state.apiKey),
      keyTail: keyHint(state.apiKey),
      source: state.source,
    },
    ready: oracleReady(state.settings, Boolean(state.apiKey)),
  };
}

/* ------------------------------------------------------------------ *
 *  Accepting a change from the menu
 * ------------------------------------------------------------------ */

/* An empty key means "leave the one you have", because the field is a password
 * box that never shows what is in it — clearing it by typing nothing is not
 * something anyone means to do. `clearKey` is how you actually mean it. */
/* The same resolution applySettings does, minus the demand for a model —
 * because asking an endpoint what it serves is exactly the moment you do not
 * know one yet. Still insists on a reachable http(s) address, since this is
 * the server being told where to send a request. */
export function settingsForListing(state, body) {
  const req = body && typeof body === 'object' ? body : {};
  const settings = resolveOracle({
    provider: req.provider,
    dialect: req.dialect,
    baseUrl: req.baseUrl,
    model: req.model || 'unknown',
  });
  if (!settings.baseUrl) throw badRequest('an endpoint is needed before it can be asked anything');
  assertHttpUrl(settings.baseUrl);
  let apiKey = state.apiKey;
  if (typeof req.apiKey === 'string' && req.apiKey.trim()) apiKey = req.apiKey.trim();
  return { settings, apiKey };
}

export function applySettings(state, body) {
  const req = body && typeof body === 'object' ? body : {};
  const settings = resolveOracle({
    provider: req.provider,
    dialect: req.dialect,
    baseUrl: req.baseUrl,
    model: req.model,
  });

  if (!settings.model) throw badRequest('name a model — the field cannot be blank');
  if (!settings.baseUrl) throw badRequest('a custom oracle needs an endpoint to answer at');
  assertHttpUrl(settings.baseUrl);

  let apiKey = state.apiKey;
  if (req.clearKey === true) apiKey = '';
  else if (typeof req.apiKey === 'string' && req.apiKey.trim()) apiKey = req.apiKey.trim();

  return { settings, apiKey, source: 'saved' };
}

function assertHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest(`"${url}" is not an address the server can reach`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('the endpoint has to be http or https');
  }
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/* ------------------------------------------------------------------ *
 *  Speaking to it
 * ------------------------------------------------------------------ */

/* Pure, so the shape of every request the server can make is covered by a test
 * rather than by trying one and reading the error. */
export function buildRequest(settings, apiKey, prompt, opts = {}) {
  /* Four thousand was a figure for a model that answers. A reasoning one
   * spends a page and a half thinking before it writes anything — measured at
   * five and a half thousand characters of design notes ahead of the object —
   * and then has a whole dungeon to emit. Running out mid-object is the
   * failure the playtest hit, and it reads as a broken oracle rather than a
   * short one, so the budget is generous by default and the caller can ask
   * for more. */
  const maxTokens = opts.maxTokens || 8000;
  const temperature = opts.temperature === undefined ? 0.9 : opts.temperature;
  const base = trimSlash(settings.baseUrl);

  if (settings.dialect === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: {
        model: settings.model,
        max_tokens: maxTokens,
        temperature,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      },
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  /* Ollama and LM Studio want no Authorization header at all, and some of them
   * reject an empty bearer rather than ignoring it. */
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      model: settings.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
    },
  };
}

/* A DIALOGUE TURN, not a content commission: an in-character system prompt and
 * a real message history, rather than the JSON-designer prompt the generator
 * uses. Same dialects and the same reachability, so a bound provider needs no
 * new plumbing to play the cast. */
export function buildChatRequest(settings, apiKey, system, messages, opts = {}) {
  const maxTokens = opts.maxTokens || 300;
  const temperature = opts.temperature === undefined ? 0.85 : opts.temperature;
  const base = trimSlash(settings.baseUrl);
  const msgs = (messages || []).map((m) => ({
    role: m && m.role === 'npc' ? 'assistant' : (m && m.role === 'player' ? 'user' : (m && m.role) || 'user'),
    content: String((m && (m.text != null ? m.text : m.content)) || ''),
  }));

  if (settings.dialect === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: { model: settings.model, max_tokens: maxTokens, temperature, system, messages: msgs },
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      model: settings.model,
      messages: [{ role: 'system', content: system }, ...msgs],
      temperature,
      max_tokens: maxTokens,
    },
  };
}

export function extractText(dialect, data) {
  if (!data || typeof data !== 'object') return '';
  if (dialect === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : [];
    return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
  }
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice && choice.message;
  if (!message) return '';
  /* Some OpenAI-compatible servers return content as an array of parts. */
  if (Array.isArray(message.content)) {
    return message.content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join('').trim();
  }
  return String(message.content || '').trim();
}

/* A hosted endpoint refusing because the ceiling is above its own output
 * limit — the one thing a generous default can break that a stingy one
 * cannot. Worth one quiet retry rather than a wall of API text. */
function isCeilingComplaint(status, detail) {
  if (status !== 400 && status !== 422) return false;
  return /max_?tokens|max_output|maximum.*tokens|token.*limit/i.test(String(detail || ''));
}

export async function callOracle(state, prompt, opts = {}) {
  if (!oracleReady(state.settings, Boolean(state.apiKey))) {
    const err = new Error('No oracle is bound — choose a provider in the Black Library');
    err.code = 'NO_ORACLE';
    err.status = 503;
    throw err;
  }
  try {
    return await callOnce(state, prompt, opts);
  } catch (err) {
    if (!err || !err.ceilingTooHigh) throw err;
    /* Say nothing to the player: the answer still arrives, just from a model
     * that could not be asked for as much room as a local one can. */
    return await callOnce(state, prompt, { ...opts, maxTokens: 4000 });
  }
}

async function sendRequest(state, req, opts) {
  const controller = new AbortController();
  /* A minute is generous for a hosted endpoint and short for a local one: a
   * 35B on your own GPU writing a whole dungeon — three monsters, two items
   * and a boss, in strict JSON, after some reasoning preamble — runs past it
   * routinely, and the failure reads as a broken endpoint rather than as a
   * slow one. Four minutes costs nothing when the call succeeds. */
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 240_000);
  let res;
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(reachError(state.settings, e));
    err.status = 502;
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* nothing readable came back */ }
    const err = new Error(`${labelOf(state.settings)} refused the request (${res.status}): ${detail.slice(0, 300)}`);
    err.status = res.status === 401 || res.status === 403 ? 502 : res.status;
    if (isCeilingComplaint(res.status, detail) && (opts.maxTokens || 0) > 4000) err.ceilingTooHigh = true;
    throw err;
  }
  const data = await res.json().catch(() => null);
  const text = extractText(state.settings.dialect, data);
  if (!text) {
    const err = new Error(`${labelOf(state.settings)} answered with nothing at all`);
    err.status = 502;
    throw err;
  }
  return text;
}

async function callOnce(state, prompt, opts) {
  return sendRequest(state, buildRequest(state.settings, state.apiKey, prompt, opts), opts);
}

/* A DIALOGUE TURN, reachable the same way a content commission is. Same
 * readiness check, same one-quiet-retry when a hosted endpoint's ceiling is
 * below what was asked for. */
export async function callOracleChat(state, system, messages, opts = {}) {
  if (!oracleReady(state.settings, Boolean(state.apiKey))) {
    const err = new Error('No oracle is bound — choose a provider in the Black Library');
    err.code = 'NO_ORACLE';
    err.status = 503;
    throw err;
  }
  const req = buildChatRequest(state.settings, state.apiKey, system, messages, opts);
  try {
    return await sendRequest(state, req, opts);
  } catch (err) {
    if (!err || !err.ceilingTooHigh) throw err;
    return await sendRequest(state, buildChatRequest(state.settings, state.apiKey, system, messages, { ...opts, maxTokens: 4000 }), { ...opts, maxTokens: 4000 });
  }
}

function labelOf(settings) {
  const p = providerById(settings.provider);
  return p ? p.label : settings.provider;
}

/* A local model that is not running is by far the most common failure here,
 * and "fetch failed" tells the player nothing about which thing to start. */
function reachError(settings, cause) {
  const why = cause && cause.name === 'AbortError' ? 'took too long to answer' : 'could not be reached';
  return `${labelOf(settings)} ${why} at ${settings.baseUrl}. ${
    /localhost|127\.0\.0\.1/.test(settings.baseUrl)
      ? 'Is the local server running?'
      : 'Check the endpoint and your connection.'}`;
}

/* One cheap round trip, so BIND can be told apart from WORKS. */
/* WHAT THIS ENDPOINT ACTUALLY SERVES.
 *
 * Binding a hosted provider is a menu choice; binding a box on your own
 * network is not, because nobody remembers the exact id a local server files
 * a model under — "Ornith-1.5" on the tin can be `ornith-1.5-instruct-q5` to
 * the API, and one character wrong reads as a dead endpoint. So ask it.
 *
 * Two shapes cover the field. Everything OpenAI-compatible answers GET
 * /models with { data: [{ id }] }, which is what Ollama, LM Studio, vLLM and
 * llama.cpp all speak on their /v1 path; Ollama's own native API answers
 * /api/tags with { models: [{ name }] }, and is worth the second try because
 * people point at the bare host as often as at /v1. */
export async function listModels(settings, apiKey) {
  const base = String(settings.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('no endpoint to ask');
  const headers = {};
  if (settings.dialect === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const tries = [`${base}/models`];
  /* A bare host, or a /v1 that does not answer: Ollama's own listing. */
  tries.push(base.replace(/\/v1$/, '') + '/api/tags');

  let last = null;
  for (const url of tries) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      let res;
      try {
        res = await fetch(url, { headers, signal: ctl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) { last = new Error(`${url} answered ${res.status}`); continue; }
      const data = await res.json();
      const names = Array.isArray(data.data)
        ? data.data.map((m) => m && (m.id || m.name)).filter(Boolean)
        : Array.isArray(data.models)
          ? data.models.map((m) => (typeof m === 'string' ? m : m && (m.name || m.id))).filter(Boolean)
          : [];
      if (names.length) return names.map(String).sort();
      last = new Error(`${url} listed nothing`);
    } catch (err) {
      /* "fetch failed" tells a player nothing they can act on. Name the
       * address that did not answer — with a local box the answer is nearly
       * always a wrong port or a server that is not running. */
      const why = err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || 'did not answer';
      last = new Error(`${url} ${why}`);
    }
  }
  throw last || new Error('the endpoint did not answer');
}

export async function probeOracle(state) {
  const text = await callOracle(state, 'Reply with the single word: ready', {
    maxTokens: 16, temperature: 0, timeoutMs: 20_000,
  });
  return text.slice(0, 80);
}
