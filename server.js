import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function appendExpansion(expansion) {
  const list = readExpansions();
  expansion.id = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  expansion.installedAt = new Date().toISOString();
  list.push(expansion);
  fs.writeFileSync(EXPANSIONS_FILE, JSON.stringify(list, null, 2));
  return expansion;
}

/* ------------------------------------------------------------------ *
 *  Validation.  We whitelist fields, clamp numbers, never trust the
 *  model's types, and refuse anything that looks wrong.
 * ------------------------------------------------------------------ */

const COLORS = new Set([
  'green', 'amber', 'white', 'gray', 'silver', 'red', 'brightred', 'orange',
  'yellow', 'brightgreen', 'cyan', 'brightblue', 'blue', 'magenta', 'pink',
  'brown', 'darkgray', 'violet', 'gold', 'teal',
]);

const ITEM_KINDS = new Set(['weapon', 'armor', 'shield', 'ring', 'amulet', 'potion', 'wand', 'scroll', 'special', 'misc']);
const EFFECT_SPELLS = new Set(['firebolt', 'fireball', 'frost', 'reveal', 'light', 'heal', 'detectevil', 'purge', 'teleport', 'identify', 'removecurse']);
const MONSTER_PROPS = new Set(['undead', 'poison', 'regenerate', 'ranged', 'flying', 'intelligent', 'cursed', 'pack', 'trap']);
const DUNGEON_THEMES = new Set(['temple', 'cavern', 'sewers', 'crystal', 'fire', 'ice', 'jungle', 'tomb', 'halls', 'abyss', 'arcane']);
const CLASSES = new Set(['fighter', 'thief', 'mage', 'cleric']);
const ABILITY_KINDS = new Set(['damage', 'heal', 'buff', 'reveal', 'teleport', 'turn', 'passive']);

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function str(v, lo, hi, dflt = '') {
  if (typeof v !== 'string') return dflt;
  const s = v.trim();
  if (s.length === 0) return dflt;
  return s.slice(0, hi);
}

function glyph(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s && s.length >= 1) return s.slice(0, 1).toUpperCase();
  return '?';
}

function color(v) {
  const c = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return COLORS.has(c) ? c : 'white';
}

function dice(v, defaultSides = 6, count = 1) {
  let sides = defaultSides;
  if (typeof v === 'number' && Number.isFinite(v)) sides = clampInt(v, 1, 100, defaultSides);
  else if (v && typeof v === 'object') sides = clampInt(v.sides, 1, 100, defaultSides);
  return { dice: count, sides };
}

function validateEffects(e) {
  if (!e || typeof e !== 'object') return {};
  const out = {};
  if ('toHit' in e) out.toHit = clampInt(e.toHit, -10, 15, 0);
  if ('acBonus' in e) out.acBonus = clampInt(e.acBonus, -8, 12, 0);
  if ('heal' in e) out.heal = clampInt(e.heal, 1, 100, 1);
  if ('power' in e) out.power = clampInt(e.power, 1, 100, 1);
  if ('charges' in e) out.charges = clampInt(e.charges, 1, 30, 1);
  if ('spell' in e && EFFECT_SPELLS.has(e.spell)) out.spell = e.spell;
  if ('property' in e) out.property = str(e.property, 0, 20, '');
  const dmg = e.damage || e.dmg;
  if (dmg) {
    const sides = typeof dmg === 'number' ? dmg : dmg.sides;
    const count = dmg && typeof dmg === 'object' ? clampInt(dmg.dice ?? dmg.count, 1, 10, 1) : 1;
    out.damage = dice(sides, 6, count);
  }
  const sb = {};
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    if (e && typeof e === 'object' && e[k] !== undefined) sb[k] = clampInt(e[k], 1, 5, 0);
    else if (e && typeof e.statBonus === 'object' && Number.isFinite(e.statBonus[k])) sb[k] = clampInt(e.statBonus[k], 1, 5, 0);
  }
  if (Object.keys(sb).length) out.statBonus = sb;
  return out;
}

function validateItem(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('item payload missing');
  const kind = ITEM_KINDS.has(raw.kind) ? raw.kind : 'misc';
  const effects = validateEffects(raw.effects || raw);
  const slot = raw.slot;
  const item = {
    type: 'item',
    name: str(raw.name, 2, 48, 'Curious Object'),
    kind,
    slot: str(slot, 1, 16, slotMap(kind)),
    glyph: glyph(raw.glyph || '?'),
    color: color(raw.color),
    value: clampInt(raw.value, 0, 500000, 10),
    tier: clampInt(raw.tier, 0, 15, 1),
    cursed: raw.cursed === true,
    flavor: str(raw.flavor, 0, 240, ''),
    effects,
  };
  return item;
}

function slotMap(kind) {
  switch (kind) {
    case 'weapon': return 'weapon';
    case 'armor': return 'body';
    case 'shield': return 'shield';
    case 'ring': return 'ring';
    case 'amulet': return 'amulet';
    case 'wand': return 'weapon';
    case 'scroll': return 'consumable';
    case 'potion': return 'consumable';
    default: return 'misc';
  }
}

function validateMonster(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('monster payload missing');
  const dmg = raw.damage || raw.dmg;
  const m = {
    type: 'monster',
    name: str(raw.name, 2, 40, 'Unknown Horror'),
    glyph: glyph(raw.glyph || 'M'),
    color: color(raw.color),
    tier: clampInt(raw.tier, 0, 15, 1),
    hpMax: clampInt(raw.hpMax, 1, 4000, 10),
    ac: clampInt(raw.ac, -10, 12, 10),
    toHit: clampInt(raw.toHit, -5, 20, 0),
    damage: dice(dmg, 6, 1),
    dmgBonus: clampInt(raw.dmgBonus ?? raw.damageBonus, 0, 20, 0),
    xp: clampInt(raw.xp, 1, 100000, 50),
    goldMin: clampInt(raw.goldMin, 0, 100000, 0),
    goldMax: clampInt(raw.goldMax, Math.max(0, raw.goldMin || 0), 100000, 10),
    speed: clampInt(raw.speed, 1, 4, 1),
    aggroRange: clampInt(raw.aggroRange, 1, 20, 8),
    properties: Array.isArray(raw.properties) ? [...new Set(raw.properties.filter((p) => MONSTER_PROPS.has(p)))].slice(0, 6) : [],
    flavor: str(raw.flavor, 0, 240, ''),
  };
  if (m.goldMax < m.goldMin) m.goldMax = m.goldMin;
  return m;
}

function validateAbility(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('ability payload missing');
  return {
    type: 'ability',
    cls: CLASSES.has(raw.cls) ? raw.cls : (CLASSES.has(raw.class) ? raw.class : 'fighter'),
    name: str(raw.name, 2, 40, 'New Ability'),
    level: clampInt(raw.level, 1, 20, 1),
    kind: ABILITY_KINDS.has(raw.kind) ? raw.kind : 'passive',
    powerCost: clampInt(raw.powerCost, 0, 50, 0),
    cooldown: clampInt(raw.cooldown, 0, 20, 0),
    power: clampInt(raw.power ?? raw.powerCost, 0, 50, 0),
    range: clampInt(raw.range, 1, 30, 1),
    aura: clampInt(raw.aura, 1, 8, 3),
    damage: raw.damage ? { dice: NaN, sides: clampInt(raw.damage.sides ?? raw.damage, 1, 100, 4), bonus: clampInt(raw.damage.bonus, 0, 30, 0) } : null,
    bonus: clampInt(raw.bonus, 1, 30, 1),
    description: str(raw.description, 0, 300, ''),
    flavor: str(raw.flavor, 0, 240, ''),
  };
}

function validateDungeon(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('dungeon payload missing');
  const monsters = Array.isArray(raw.monsters) ? raw.monsters.slice(0, 4).map(validateMonster) : [];
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 3).map(validateItem) : [];
  return {
    type: 'dungeon',
    name: str(raw.name, 2, 48, 'The Unknown Sanctum'),
    title: str(raw.title, 0, 80, ''),
    flavor: str(raw.flavor, 0, 400, 'A strange place beneath the earth.'),
    floors: clampInt(raw.floors, 2, 6, 3),
    theme: DUNGEON_THEMES.has(raw.theme) ? raw.theme : 'temple',
    threat: clampInt(raw.threat, -4, 12, 0),
    palette: {},
    monsters,
    items,
    boss: raw.boss ? validateMonster({ ...raw.boss, tier: clampInt(raw.boss.tier, 3, 15, 5) }) : null,
  };
}

function validateExpansion(obj) {
  const type = obj && typeof obj === 'object' ? obj.type : '';
  switch (type) {
    case 'item': return validateItem(obj.item || obj.payload || obj);
    case 'monster': return validateMonster(obj.monster || obj.payload || obj);
    case 'ability': return validateAbility(obj.ability || obj.payload || obj);
    case 'dungeon': return validateDungeon(obj.dungeon || obj.payload || obj);
    default: throw new Error(`unsupported expansion type: ${type}`);
  }
}

/* ------------------------------------------------------------------ *
 *  LLM prompt building
 * ------------------------------------------------------------------ */

const TYPES_LABEL = {
  dungeon: 'a new playable DUNGEON',
  monster: 'a new MONSTER',
  item: 'a new ITEM',
  ability: 'a new PLAYER ABILITY',
};

function buildPrompt(action, context) {
  const ctx = context || {};
  const extra = ctx.theme ? ` Theme/feel: ${ctx.theme}.` : '';
  const depth = ctx.depth !== undefined ? ` It should fit an adventurer around player level ${ctx.depth}.` : '';
  const world = ctx.existing
    ? ` Existing world elements to riff on (you may create fresh ones but keep it distinct): ${String(ctx.existing).slice(0, 600)}.`
    : '';
  const flavor = ctx.flavor ? ` Narrative context: ${String(ctx.flavor).slice(0, 300)}` : '';

  const base = `You are co-designing content for a tabletop-styled, turn-based dungeon crawler inspired by Dungeons & Dragons' Temple of Lapsai.
${extra}${depth}${world}${flavor}

Output STRICT JSON only (no markdown fences, no prose) matching exactly one of the schemas below depending on the requested type. Make it flavorful, concise, balanced, and evocative of classic 1980s pen-and-paper D&D modules. Names should be short and memorable.`;

  const sharedItem = `
valid colors: green,amber,white,gray,silver,red,brightred,orange,yellow,brightgreen,cyan,brightblue,blue,magenta,pink,brown,black,violet,gold,teal.
"glyph" is one uppercase or lowercase ASCII character shown on the map.
"tier" is a 0-15 power rating (0=safe, 3=normal floor 1, 8=deep, 12+=endgame).
`;

  if (action === 'item') {
    return base + `
CREATE A NEW ITEM.
Schema: {"type":"item","item":{ "name":string, "kind":"weapon"|"armor"|"shield"|"ring"|"amulet"|"potion"|"wand"|"scroll"|"special"|"misc", "slot":string, "glyph":string, "color":string, "value":int, "tier":int, "cursed":bool, "flavor":string, "effects":{ "toHit":int, "acBonus":int, "damage":{"dice":int, "sides":int}, "heal":int, "power":int, "charges":int, "spell":"firebolt"|"fireball"|"frost"|"reveal"|"light"|"heal"|"detectevil"|"purge"|"teleport"|"identify"|"removecurse", "property":string, "statBonus":{"str":int,"dex":int,"con":int,"int":int,"wis":int,"cha":int}}}}
For weapons/armor/shields fill toHit/damage or acBonus appropriately. Only"cursed" should be true on a small minority.${sharedItem}`;
  }

  if (action === 'monster') {
    return base + `
CREATE A NEW MONSTER.
Schema: {"type":"monster","monster":{ "name":string, "glyph":string, "color":string, "tier":int, "hpMax":int, "ac":int, "toHit":int, "damage":{"dice":int, "sides":int}, "dmgBonus":int, "xp":int, "goldMin":int, "goldMax":int, "speed":int, "aggroRange":int, "properties":["undead"|"poison"|"regenerate"|"ranged"|"flying"|"intelligent"|"cursed"|"pack"], "flavor":string}}
AC uses descending D&D values (10 = unarmored human, lower is tougher). Give it a memorable monstrous name.${sharedItem}`;
  }

  if (action === 'ability') {
    return base + `
CREATE A NEW PLAYER ABILITY for a ${ctx.cls || 'fighter'} : active or passive.
Schema: {"type":"ability","ability":{ "cls":"fighter"|"thief"|"mage"|"cleric", "name":string, "level":int, "kind":"damage"|"heal"|"buff"|"reveal"|"teleport"|"turn"|"passive", "powerCost":int, "cooldown":int, "range":int, "aura":int, "damage":{"sides":int,"bonus":int}, "bonus":int, "description":string (rules text, under 200 chars), "flavor":string}}
Make it feel like a classic D&D class feature. Keep numbers modest for a low-tech OSR feel.`;
  }

  if (action === 'dungeon') {
    return base + `
CREATE A NEW DUNGEON for the world of Lapsai.
Schema: {"type":"dungeon","dungeon":{ "name":string, "title":string, "flavor":string (3-5 sentences of hand-authored flavor the player sees when entering), "floors":int 2..6, "theme":"temple"|"cavern"|"sewers"|"crystal"|"fire"|"ice"|"jungle"|"tomb"|"halls"|"abyss"|"arcane", "threat":int -4..12, "monsters":[ {MONSTER SCHEMA x2..3}, ], "items":[ {ITEM SCHEMA x1..2}, ], "boss":{MONSTER SCHEMA} } }
The dungeon's monsters and items should feel native to its theme. The boss is the guardian of the lowest floor. Colors/glyphs as allowed.${sharedItem}`;
  }

  return base;
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

function extractJSON(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in LLM response');
  return JSON.parse(t.slice(start, end + 1));
}

async function handleExpand(action, context) {
  const prompt = buildPrompt(action, context);
  const text = await callLLM(prompt);
  const parsed = extractJSON(text);
  const expansion = validateExpansion(parsed);
  return appendExpansion(expansion);
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
