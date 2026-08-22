/* Temple of Lapsai — main.js: UI controller.
 * Owns the DOM/canvas; every engine callback is routed through the `ui` object.
 */

import { Game, rollStats, initialStats } from './engine.js';
import { CLASSES, getTheme, abilityMod, XP_FOR_LEVEL, cls } from './base.js';
import { T, W, H } from './mapgen.js';
import { dialogue, NPC_GLYPH } from './npc.js';
import { WORLD } from './world.js';

/* ---------------- constants ---------------- */
const SAVE_KEY = 'lapsai-save';
const REGISTRY_KEY = 'lapsai-registry';

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('game'),
  ctx: $('game').getContext('2d'),
  location: $('location'),
  topstatus: $('topstatus'),
  log: $('log'),
  hpFill: $('hp-fill'),
  hpText: $('hp-text'),
  powFill: $('pow-fill'),
  powText: $('pow-text'),
  overlay: $('overlay'),
  boot: $('boot'),
  saveNote: $('save-note'),
  btnNew: $('btn-new'),
  btnContinue: $('btn-continue'),
  charcreate: $('charcreate'),
  classPicker: $('class-picker'),
  btnReroll: $('btn-reroll'),
  attrGrid: $('attr-grid'),
  classBonus: $('class-bonus'),
  charName: $('char-name'),
  btnEnter: $('btn-enter'),
  statBlock: $('stat-block'),
  abilitiesBlock: $('abilities-block'),
  equipmentBlock: $('equipment-block'),
  inventoryBlock: $('inventory-block'),
  beltBlock: $('belt-block'),
  dungeonCodex: $('dungeon-codex'),
  libraryBlock: $('library-block'),
  libOverlay: $('library-overlay'),
  libStatus: $('lib-status'),
  libActions: $('lib-actions'),
  libFocus: $('lib-focus'),
  libResult: $('lib-result'),
  btnLibClose: $('btn-library-close'),
  itemDetail: $('item-detail'),
  death: $('death'),
  deathMsg: $('death-msg'),
  btnResurrect: $('btn-resurrect'),
  btnRoster: $('btn-roster'),
  arrival: $('dungeon-arrival'),
  arrivalTitle: $('arrival-title'),
  arrivalFlavor: $('arrival-flavor'),
  btnArrivalOk: $('btn-arrival-ok'),
  victory: $('victory'),
  victoryMsg: $('victory-msg'),
  btnVictoryOk: $('btn-victory-ok'),
  dialogue: $('dialogue'),
  dlgName: $('dlg-name'),
  dlgLog: $('dlg-log'),
  dlgInput: $('dlg-input'),
  dlgSend: $('dlg-send'),
  viewport: $('viewport'),
  help: $('help'),
  helpKeys: $('help-keys'),
  btnHelp: $('btn-help'),
  btnHelpClose: $('btn-help-close'),
};

/* The one list of controls: the help card is built from it, so what the game
 * tells you and what the game does cannot drift apart. */
const CONTROLS = [
  ['Getting about', [
    ['W A S D  ·  arrows', 'Walk one tile. Walk into a monster to attack it, into a door to open it, into a person to talk.'],
    ['Space  ·  X', 'Wait where you are and let the turn pass.'],
    ['<  ·  >', 'Stairs. Step onto them to climb or descend — you cannot leave with something at your heels.'],
  ]],
  ['Things on the ground', [
    ['G', 'Take what is underfoot. With nothing there, look around instead and see what lies within reach.'],
    ['$ ! ? = &  and other glyphs', 'Loot waiting to be picked up. Coins and treasure are taken automatically as you step on them.'],
  ]],
  ['Your character', [
    ['1 – 9', 'Use the matching power from the STAT SHEET.'],
    ['I  ·  E', 'Gear: equip, use, and drop what you are carrying. Right-click an item to drop it.'],
    ['C', 'Codex: the depths you know about.'],
    ['L', 'The Black Library, where new depths get written.'],
    ['Tab', 'Cycle those four panels.'],
  ]],
  ['Talking and dialogs', [
    ['Enter', 'Start the game, or send a line of dialogue.'],
    ['Esc', 'Leave a conversation.'],
    ['?  ·  H', 'This card.'],
  ]],
];

/* ---------------- state ---------------- */
let game = null;
let currentTab = 'stats';
let selClass = 'fighter';
let rolled = null;
let llmConfigured = false;
let initializing = false;

// Expansion registry merged into every Game; persists locally and is
// re-hydrated from the server on boot.
let registry = {
  items: [],
  monsters: [],
  dungeons: [],
  abilities: [],
};

function loadRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (raw) registry = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return registry;
}
function persistRegistry() {
  try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry)); } catch (e) { /* ignore */ }
}

function makeGame() {
  const g = new Game({
    registry,
    ui: makeUI(),
    onAllBaseCleared() {
      logLine('The founding chronicle is complete. The Black Library stands ready to write new depths.', 'gold');
    },
  });
  return g;
}

/* ---------------- log ---------------- */
function logLine(text, kind) {
  if (!text) return;
  const d = document.createElement('div');
  d.className = 'l' + (kind ? ' ' + kind : '');
  d.textContent = text;
  els.log.appendChild(d);
  while (els.log.childElementCount > 140) els.log.firstElementChild.remove();
  els.log.scrollTop = els.log.scrollHeight;
}

function logByKind(text) {
  const s = String(text);
  let kind = 'info';
  if (/slain|strike|blast|blows|hit|damage|burn|bite|wound|cursed| slain/i.test(s)) kind = 'combat';
  else if (/gold|treasure|loot|stripped|'gold'/i.test(s)) kind = 'gold';
  else if (/heal|relief|knit|warmth|rest|wise|strong/i.test(s)) kind = 'heal';
  else if (/new|unlock|opened|arrives|remember/i.test(s)) kind = 'good';
  logLine(s, kind);
}

/* ---------------- UI factory (engine -> UI) ---------------- */
function makeUI() {
  const self = {
    log: logByKind,
    render: (g) => { game = g; renderGame(g); },
    refreshHud: (g) => renderHud(g),
    refreshStats: (g) => { if (currentTab === 'stats') renderStats(g); },
    setLocation: (s) => { els.location.textContent = s; },
    showFloor: () => {},
    showArrival: (d) => showArrival(d),
    openDialogue: (npc) => openDialogue(npc),
    showCamp: (g) => showCamp(g),
    showDeath: (msg) => showDeath(msg),
    showVictory: (run) => showVictoryCard(run),
    showBeat: (beat) => showBeat(beat),
    unlock: (d) => {
      logLine('A new path is opened: ' + d.name + ' — ' + (d.title || '') , 'good');
      renderCodex(game);
      renderLibrary(game);
    },
    flagNpcIntroduced: () => { if (currentTab === 'codex') renderCodex(game); },
    prepareTransition: () => { els.topstatus.textContent = '…descending…'; },
  };
  return self;
}

/* ---------------- overlays -------------*/
function overlayShow(el) {
  els.overlay.classList.remove('hidden');
  el.classList.remove('hidden');
}
function overlayHideAll() {
  els.overlay.classList.add('hidden');
  // Query rather than list ids: the camp card is built at runtime, and a card
  // left visible reappears under the next overlay that opens.
  for (const card of els.overlay.querySelectorAll('.overlay-card')) card.classList.add('hidden');
  const camp = $('camp-card');
  if (camp) camp.remove();
}

/* Narrative cards queue instead of racing. Arriving in a dungeon, the beat for
 * the floor you land on, and the ending can all want the screen in the same
 * tick — and showArrival and showBeat write to the SAME card, so without this
 * the second silently overwrites the first. */
let cardQueue = [];
let cardShowing = false;

function enqueueCard(render) {
  cardQueue.push(render);
  if (!cardShowing) nextCard();
}

function nextCard() {
  const render = cardQueue.shift();
  if (!render) {
    cardShowing = false;
    overlayHideAll();
    canvasFocus();
    return;
  }
  cardShowing = true;
  overlayHideAll();
  render();
}

function clearCards() {
  cardQueue = [];
  cardShowing = false;
}

function showArrival(d) {
  enqueueCard(() => {
    els.arrivalTitle.textContent = String(d.name || '').toUpperCase();
    els.arrivalFlavor.textContent = d.flavor || '';
    overlayShow(els.arrival);
  });
}

function showBeat(beat) {
  if (!beat) return;
  enqueueCard(() => {
    els.arrivalTitle.textContent = String(beat.title || 'THE DARK SPEAKS');
    els.arrivalFlavor.textContent = beat.text || '';
    overlayShow(els.arrival);
  });
}

function showHelp() {
  els.helpKeys.innerHTML = CONTROLS.map(([group, rows]) =>
    '<h3 class="pane">' + group + '</h3><table class="keys">' +
    rows.map(([k, what]) => '<tr><td class="k"><kbd>' + k + '</kbd></td><td class="v">' + what + '</td></tr>').join('') +
    '</table>').join('');
  overlayShow(els.help);
  helpOpen = true;
}

function buildVictory(run) {
  const c = CLASSES[run.cls] || CLASSES.fighter;
  els.victoryMsg.innerHTML =
    '<p class="flavor">Three sanctums are quiet. Whatever was owed down there, you have collected on it, ' +
    'and the dark has learned your name well enough to stop using it.</p>' +
    '<table class="stats">' +
    '<tr><td class="k">Name</td><td class="v">' + esc(run.name) + '</td></tr>' +
    '<tr><td class="k">Standing</td><td class="v">' + esc(c.name) + ', level ' + run.level + '</td></tr>' +
    '<tr><td class="k">Purse</td><td class="v">' + run.gold + ' gp</td></tr>' +
    '<tr><td class="k">Slain</td><td class="v">' + run.kills + '</td></tr>' +
    '</table>' +
    '<p class="flavor">The Black Library is open to you now. Ask it for somewhere new to die.</p>';
}

function showVictoryCard(run) {
  enqueueCard(() => { buildVictory(run); overlayShow(els.victory); });
}

function showDeath(msg) {
  clearCards();
  overlayHideAll();
  els.deathMsg.textContent = msg || 'You were laid low in the dark.';
  overlayShow(els.death);
}

function showCamp(g) {
  const p = g.state.player;
  const box = document.createElement('div');
  box.id = 'camp-card';
  box.className = 'overlay-card';
  box.innerHTML =
    '<h2>CAMP</h2>' +
    '<p class="sub">Warm firelight. Your wounds knit; your purse lightens. Choose a path:</p>' +
    '<div id="camp-list"></div>' +
    '<div class="row"><button class="mini" id="btn-camp-close">ROAM AGAIN</button></div>';
  els.overlay.appendChild(box);
  overlayShow(box);
  const list = box.querySelector('#camp-list');
  for (const d of g.availableDungeons()) {
    const b = document.createElement('button');
    b.textContent = (g.isDungeonCleared(d.id) ? '[DONE] ' : '') + d.name + ' · ' + d.floors + ' floors';
    b.style.margin = '3px';
    b.onclick = () => { overlayHideAll(); box.remove(); g.enterDungeon(d.id); };
    list.appendChild(b);
  }
  box.querySelector('#btn-camp-close').onclick = () => { overlayHideAll(); box.remove(); g.loadFloor(g.state.player.floorIdx); };
}

/* ---------------- character creation ---------------- */
function appliedStats(s, clsId) {
  const c = CLASSES[clsId] || CLASSES.fighter;
  const out = {};
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    out[k] = Math.max(3, Math.min(18, (s[k] || 10) + (c.statAdj[k] || 0)));
  }
  return out;
}

function paintClassPicker() {
  els.classPicker.innerHTML = '';
  for (const id of ['fighter', 'thief', 'mage', 'cleric']) {
    const c = CLASSES[id];
    const el = document.createElement('div');
    el.className = 'class-opt' + (id === selClass ? ' sel' : '');
    el.innerHTML = '<b>' + c.name + '</b> <span class="tiny">' + c.glyph + '</span><div class="d">' + c.desc + '</div>';
    el.onclick = () => { selClass = id; paintClassPicker(); paintAttrs(); };
    els.classPicker.appendChild(el);
  }
}

function paintAttrs() {
  const c = CLASSES[selClass] || CLASSES.fighter;
  const eff = rolled ? appliedStats(rolled, selClass) : initialStats(selClass);
  els.attrGrid.innerHTML = '';
  const KEY = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const el = document.createElement('div');
    el.className = 'lbl';
    const m = abilityMod(eff[k]);
    el.innerHTML = KEY[k] + ' <span class="mod">' + (m >= 0 ? '+' : '') + m + '</span><b>' + eff[k] + '</b>';
    els.attrGrid.appendChild(el);
  }
  const hpDie = Math.max(1, c.hpDie + abilityMod(eff.con));
  els.classBonus.textContent =
    'HP ' + (c.hpBase + hpDie) + ' · base AC ' + (10 + c.acBonus) + ' · to-hit ' + (c.toHitBonus >= 0 ? '+' : '') + c.toHitBonus +
    ' · melee ' + c.dmgBonus + ' · power ' + c.powerBase + (c.powerPerInt ? '+INT' : c.powerPerChr ? '+CHA' : '') +
    ' · start: ' + c.weapon;
}

function beginCreate() {
  overlayHideAll();
  rolled = rollStats();
  paintClassPicker();
  paintAttrs();
  els.charName.value = '';
  overlayShow(els.charcreate);
  setTimeout(() => els.charName.focus(), 30);
}

function doEnter() {
  const name = (els.charName.value || '').trim();
  if (!name) { els.charName.focus(); return; }
  const eff = appliedStats(rolled, selClass);
  overlayHideAll();
  const g = makeGame();
  g.foundAdventurer(name, selClass, eff);
  logLine('The shadows part for ' + name + ', a ' + CLASSES[selClass].name + ' of the expedition.', 'good');
  startGame(g);
  saveGame();
}

function startGame(g) {
  game = g;
  els.boot.classList.add('hidden');
  els.topstatus.textContent = g.state.player.name + ' · Lv ' + g.state.player.level;
  fitCanvas();
  g.computeVisibility();
  renderAll(g);
  setTab('stats');
  canvasFocus();
}

/* ---------------- tabs ---------------- */
function setTab(tab, force) {
  currentTab = tab;
  document.querySelectorAll('#sheets-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  for (const id of ['tab-stats', 'tab-gear', 'tab-codex', 'tab-library']) {
    $(id).classList.toggle('active', id === 'tab-' + tab);
  }
  if (!game) return;
  if (tab === 'stats') renderStats(game);
  else if (tab === 'gear') renderGear(game);
  else if (tab === 'codex') renderCodex(game);
  else renderLibrary(game);
}

function renderAll(g) {
  renderGame(g);
  renderHud(g);
  renderStats(g);
  renderGear(g);
  renderCodex(g);
  renderLibrary(g);
}

/*__UI2__*/

/* ---------------- canvas renderer ---------------- */
let ts = 20;
let viewW = W, viewH = H;   /* size of the visible window, in tiles */
let camX = 0, camY = 0;     /* top-left tile of that window */
let lastTiles = '';

/* How much floor to try to show before tiles are allowed to shrink further. */
const TARGET_COLS = 42;
const TARGET_ROWS = 27;

function fitCanvas() {
  const vp = els.viewport;
  /* clientWidth/Height are in the same unzoomed CSS pixels that the canvas's
   * own style width uses, so the two agree under `html { zoom }`. Measuring
   * with getBoundingClientRect() instead is what oversized the canvas by 1.5x. */
  const w = Math.max(160, vp.clientWidth || 900);
  const h = Math.max(120, vp.clientHeight || 620);
  ts = Math.max(8, Math.min(24, Math.floor(Math.min(w / TARGET_COLS, h / TARGET_ROWS))));
  viewW = Math.max(12, Math.min(W, Math.floor(w / ts)));
  viewH = Math.max(9, Math.min(H, Math.floor(h / ts)));
  els.canvas.width = viewW * ts;
  els.canvas.height = viewH * ts;
  els.canvas.style.width = (viewW * ts) + 'px';
  els.canvas.style.height = (viewH * ts) + 'px';
  vp.style.display = 'flex';
  vp.style.alignItems = 'center';
  vp.style.justifyContent = 'center';
  lastTiles = '';
}

/* Hold the player in the middle of the window, stopping at the floor's edges. */
function updateCamera(p) {
  camX = Math.max(0, Math.min(W - viewW, p.x - Math.floor(viewW / 2)));
  camY = Math.max(0, Math.min(H - viewH, p.y - Math.floor(viewH / 2)));
}

function inView(x, y) {
  const g = game;
  if (!g || !g.vis || !g.vis[y]) return false;
  return g.vis[y][x];
}

function renderGame(g) {
  const ctx = els.ctx;
  const floor = g.currentFloor;
  if (!floor) return;
  const p = g.state.player;
  const s = ts;
  const theme = getTheme((g.dungeonById(p.dungeonId) || {}).theme);
  const sa = Math.floor(performance.now() / 700) % 2;
  updateCamera(p);
  const key = p.dungeonId + ':' + p.floorIdx + ':' + p.x + ',' + p.y +
    ':' + camX + ',' + camY + ':' + g.turn + ':' + sa;
  if (key === lastTiles && els.canvas.width) return;
  lastTiles = key;

  ctx.fillStyle = '#050705';
  ctx.fillRect(0, 0, viewW * s, viewH * s);
  ctx.font = 'bold ' + Math.max(12, Math.round(s * 0.75)) + 'px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = camY; y < camY + viewH; y++) {
    for (let x = camX; x < camX + viewW; x++) {
      const t = floor.tiles[y][x];
      const seen = g.seen && g.seen[y] && g.seen[y][x];
      const vis = g.vis && g.vis[y] && g.vis[y][x];
      const px = (x - camX) * s, py = (y - camY) * s;
      if (!seen) {
        ctx.fillStyle = '#040503';
        ctx.fillRect(px, py, s, s);
        continue;
      }
      let fill = theme.floor, glyph = '', gcol = theme.accent;
      if (t === T.WALL) {
        fill = theme.wall;
        glyph = '';
        let hl = false;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) {
            const nt = floor.tiles[ny][nx];
            if ((nt === T.FLOOR || nt === T.DOWN || nt === T.UP || nt === T.DOOR_O) && g.vis[ny] && g.vis[ny][nx]) { hl = true; break; }
          }
        }
        fill = hl ? theme.wallHi : theme.wall;
      } else if (t === T.DOOR_C) {
        fill = theme.door;
      } else if (t === T.SECRET) {
        fill = theme.secret;
        if (vis && sa === 0) { glyph = '+'; gcol = theme.accent; }
      } else if (t === T.UP) {
        fill = vis ? theme.floor : theme.floorEdge;
        glyph = '<'; gcol = theme.accent;
      } else if (t === T.DOWN) {
        fill = vis ? theme.floor : theme.floorEdge;
        glyph = '>'; gcol = theme.accent;
      } else if (t === T.WATER) {
        fill = sa ? '#14202e' : '#18263a';
        if (vis) { glyph = '~'; gcol = '#3f6faa'; }
      } else if (t === T.ALTAR) {
        fill = theme.floorEdge;
        glyph = 'Ω'; gcol = '#e0c05a';
      } else if (t === T.DEN) {
        fill = theme.floorEdge;
        glyph = 'O'; gcol = theme.wallHi;
      } else {
        fill = theme.floor;
      }
      if (vis) {
        ctx.fillStyle = fill;
        ctx.fillRect(px, py, s, s);
        if (glyph) { ctx.fillStyle = gcol; ctx.fillText(glyph, px + s / 2, py + s / 2 + 1); }
      } else {
        const dim = shade(fill, 0.42);
        ctx.fillStyle = dim;
        ctx.fillRect(px, py, s, s);
        if (glyph) { ctx.fillStyle = shade(gcol, 0.5); ctx.fillText(glyph, px + s / 2, py + s / 2 + 1); }
      }
    }
  }

  for (const m of floor.monsters || []) {
    if (m.hp <= 0 || !m.t) continue;
    if (!inView(m.x, m.y) && !m.revealed) continue;
    drawGlyph(m.x, m.y, m.t.glyph, cls(m.t.color), !inView(m.x, m.y));
  }
  for (const it of floor.items || []) {
    if (!inView(it.x, it.y)) continue;
    const tpl = it.i;
    drawGlyph(it.x, it.y, tpl.glyph || '$', cls(tpl.color || 'gold'), false);
  }
  for (const n of floor.npcs || []) {
    if (!inView(n.x, n.y)) continue;
    /* The floor entry is {tpl,x,y} — the colour lives on the template, so this
     * drew every NPC in the same fallback amber. */
    drawGlyph(n.x, n.y, NPC_GLYPH, cls((n.tpl && n.tpl.color) || 'amber'), false);
  }
  if (game && p) {
    drawGlyph(p.x, p.y, '@', '#f0f0e0', false, true);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect((p.x - camX) * s, (p.y - camY) * s, s, s);
  }
}

function shade(hex, f) {
  const h = parseInt(hex.slice(1), 16);
  const r = Math.round(((h >> 16) & 255) * f), gg = Math.round(((h >> 8) & 255) * f), b = Math.round((h & 255) * f);
  return 'rgb(' + r + ',' + gg + ',' + b + ')';
}

let GL = 0; // sentinel

function drawGlyph(x, y, ch, color, dim, pulse) {
  if (x < camX || y < camY || x >= camX + viewW || y >= camY + viewH) return;
  const ctx = els.ctx;
  const s = ts;
  ctx.fillStyle = dim ? shade(color, 0.7) : color;
  if (pulse && Math.floor(performance.now() / 400) % 2) ctx.globalAlpha = 0.85;
  ctx.fillText(ch, (x - camX) * s + s / 2, (y - camY) * s + s / 2 + 1);
  ctx.globalAlpha = 1;
}

/* ---------------- HUD ---------------- */
function bar(fill, text, pct) {
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  text.textContent = Math.round(pct) + '%';
}

function renderHud(g) {
  const p = g.state.player;
  if (!p) return;
  bar(els.hpFill, els.hpText, 100 * p.hp / Math.max(1, p.maxhp));
  bar(els.powFill, els.powText, 100 * p.power / Math.max(1, p.maxpower));
  els.topstatus.textContent = p.name + ' · Lv ' + p.level + ' · ' + p.hp + '/' + p.maxhp + ' hp · ' + p.power + '/' + p.maxpower + ' pwr · ' + p.gold + ' gp';
}

/* ---------------- stat sheet ---------------- */
function buffLines(p) {
  const out = [];
  if (p.buffs.turn > 0) out.push('Turned Undead (' + p.buffs.turn + ')');
  if (p.buffs.sanctuary > 0) out.push('Sanctuary (' + p.buffs.sanctuary + ')');
  if (p.buffs.str > 0) out.push('Strength Boost (lvl ' + p.buffs.str + ')');
  if (p.buffs.might > 0) out.push('Sharpened (+' + (p.buffs.mightBonus || 2) + ' to hit, ' + p.buffs.might + ')');
  return out;
}

function renderStats(g) {
  const p = g.state.player;
  if (!p) { els.statBlock.innerHTML = ''; els.abilitiesBlock.innerHTML = ''; return; }
  const c = CLASSES[p.cls] || CLASSES.fighter;
  const der = g.derived();
  const eff = der.effValues || p.stats;
  const toNext = Math.max(0, XP_FOR_LEVEL(p.level) - p.xp);
  const KEY = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
  let rows = '';
  const kv = (k, v) => rows += '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>';
  kv('Name', p.name);
  kv('Class', c.name + ' (' + c.glyph + ')');
  kv('Level', p.level);
  kv('XP', p.xp + ' / next ' + toNext);
  kv('Gold', p.gold + ' gp');
  kv('HP', p.hp + ' / ' + p.maxhp);
  kv('Power', p.power + ' / ' + p.maxpower);
  kv('AC', der.ac + ' <span class="tiny">lower is better</span>');
  kv('To-hit', der.toHit >= 0 ? '+' + der.toHit : der.toHit);
  kv('Damage', der.dmg.dice + 'd' + der.dmg.sides + (der.dmg.bonus ? '+' + der.dmg.bonus : ''));
  kv('Crit', Math.round(der.crit * 100) + '%');
  kv('Regen', der.regen || 0);
  kv('Kills', g.state.totalKills);
  els.statBlock.innerHTML = '<table class="stats">' + rows + '</table>' +
    '<h3 class="pane">ATTRIBUTES</h3><table class="stats">' +
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) =>
      '<tr><td class="k">' + KEY[k] + '</td><td class="v">' + eff[k] + ' <span style="color:var(--amb-dim)">' +
      (abilityMod(eff[k]) >= 0 ? '+' : '') + abilityMod(eff[k]) + '</span></td></tr>').join('') +
    '</table>';
  const buffs = buffLines(p);
  if (buffs.length) {
    els.statBlock.innerHTML += '<h3 class="pane">EFFECTS</h3>' + buffs.map((b) => '<div class="ability-card">' + b + '</div>').join('');
  }
  els.abilitiesBlock.innerHTML = '<h3 class="pane">POWERS (keys 1-' + g.allAbilities().length + ')</h3>';
  g.allAbilities().forEach((a, i) => {
    const cd = p.cooldowns[a.id] || 0;
    const can = p.level >= a.level && (a.kind === 'passive' || p.power >= (a.powerCost || 0)) && cd === 0;
    const el = document.createElement('div');
    el.className = 'ability-card' + (cd > 0 ? '' : '');
    el.innerHTML = '<b>[' + (i + 1) + '] ' + a.name + '</b>' +
      (a.kind === 'passive' ? ' <span class="tiny">passive</span>' : ' <span class="tiny">' + (a.powerCost || 0) + ' pwr' + (a.cooldown ? ' · cd ' + a.cooldown : '') + '</span>') +
      (a.level > 1 ? ' <span class="tiny">Lv' + a.level + '</span>' : '') +
      (cd > 0 ? ' <b style="color:var(--red-dim)">(' + cd + ')</b>' : '') +
      '<div class="desc">' + (a.description || '') + '</div>';
    if (!can && a.kind !== 'passive') el.style.opacity = 0.55;
    el.onclick = () => { if (game && !game.dying) { game.activateAbility(a.id); canvasFocus(); } };
    els.abilitiesBlock.appendChild(el);
  });
}

/* ---------------- gear ---------------- */
function itemIcon(tpl) {
  if (!tpl || tpl.value === undefined) return '?';
  if (tpl.kind === 'potion') return '¶';
  if (tpl.kind === 'scroll') return '?';
  if (tpl.kind === 'treasure') return '$';
  return (tpl.glyph || 'o')[0];
}

function renderGear(g) {
  const p = g.state.player;
  if (!p) return;
  const SLOTS = [['weapon', 'WEAPON'], ['body', 'BODY'], ['shield', 'SHIELD'], ['ring', 'RING'], ['amulet', 'AMULET']];
  let html = '';
  for (const [slot, label] of SLOTS) {
    const it = p.equipment[slot];
    const mag = it && it.cursed === false && (it.effects && (it.effects.toHit || it.effects.acBonus || it.effects.damage));
    html += '<div class="eq-row"><span class="slot">' + label + '</span>' +
      '<span class="ico">' + (it ? itemIcon(it) : '·') + '</span>' +
      '<span class="i-name' + (it && it.cursed ? ' cursed' : mag ? ' mag' : '') + '">' + (it ? it.name : '—') + '</span>' +
      (it ? '<button data-act="unequip" data-slot="' + slot + '">TAKE OFF</button>' : '') +
      '</div>';
  }
  els.equipmentBlock.innerHTML = '<h3 class="pane">EQUIPPED</h3>' + html;

  const inv = p.inventory || [];
  const ih = inv.map((it, i) =>
    '<div class="eq-row"><span class="ico">' + itemIcon(it) + '</span>' +
    '<span class="i-name' + (it.cursed ? ' cursed' : '') + '">' + it.name + '</span>' +
    '<button data-inv="' + i + '">' + (it.slot && it.slot !== 'consumable' && it.slot !== 'misc' ? 'USE' : 'USE') + '</button>' +
    '<button data-drop="' + i + '">DROP</button></div>').join('');
  els.inventoryBlock.innerHTML = '<h3 class="pane">PACK (' + inv.length + ')</h3>' + (ih || '<div class="tiny">You carry nothing.</div>');

  let belt = '';
  const b = p.belt || [null, null, null, null];
  for (let i = 0; i < b.length; i++) {
    const it = b[i];
    belt += '<div class="eq-row"><span class="slot">B' + (i + 1) + '</span>' +
      '<span class="ico">' + (it ? itemIcon(it) : '·') + '</span>' +
      '<span class="i-name">' + (it ? it.name : '—') + '</span>' +
      (it ? '<button data-belt="' + i + '">UNBIND</button>' : '') + '</div>';
  }
  els.beltBlock.innerHTML = '<h3 class="pane">BELT</h3>' + belt;
}

/* ---------------- codex ---------------- */
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* The chronicle opens as you go: two eras to begin with, one more per sanctum
 * conquered. A codex you have already read to the end is not a reward. */
function revealedHistory(g) {
  const cleared = g.baseDungeonIds().filter((id) => g.isDungeonCleared(id)).length;
  return WORLD.history.slice(0, 2 + cleared);
}

function codexSection(title, body) {
  return '<h3 class="pane">' + title + '</h3>' + (body || '<div class="tiny">Nothing is written here yet.</div>');
}

function renderCodex(g) {
  if (!g || !g.state.player) { els.dungeonCodex.innerHTML = ''; return; }
  const p = g.state.player;

  let depths = '';
  for (const d of g.availableDungeons()) {
    if (!d) continue;
    const done = g.isDungeonCleared(d.id);
    depths += '<div class="codex-item' + (done ? '' : ' unread') + '"><b>' + esc(d.name) + '</b> <span class="tiny">' +
      (done ? '· conquered' : '· ' + d.floors + ' floors') + '</span>' +
      '<p class="flavor">' + esc(d.flavor) + '</p></div>';
  }

  const eras = revealedHistory(g);
  let chronicle = eras.map((h) =>
    '<div class="codex-item"><b>' + esc(h.title) + '</b> <span class="tiny">· ' + esc(h.era) + '</span>' +
    '<p class="flavor">' + esc(h.text) + '</p></div>').join('');
  if (eras.length && eras.length < WORLD.history.length) {
    chronicle += '<div class="tiny">The later pages are still sealed. Conquer a sanctum to break the seal.</div>';
  }

  const cleared = g.baseDungeonIds().filter((id) => g.isDungeonCleared(id)).length;
  let powers = '';
  if (!cleared) {
    powers = '<div class="tiny">You have not yet come to anyone\'s attention. Give it time.</div>';
  } else {
    powers = WORLD.factions.map((f) =>
      '<div class="codex-item"><b>' + esc(f.name) + '</b> <span class="tiny">· ' + esc(f.stance) + '</span>' +
      '<p class="flavor">' + esc(f.note) + '</p></div>').join('');
  }

  const met = WORLD.npcs.filter((n) => p.npcsMet && p.npcsMet[n.id]);
  const cast = met.length
    ? met.map((n) => '<div class="codex-item"><b>' + esc(n.name) + '</b> <span class="tiny">· ' + esc(n.title) + '</span></div>').join('')
    : '<div class="tiny">You have spoken to no one down there. Walk into someone.</div>';

  els.dungeonCodex.innerHTML =
    codexSection('KNOWN DEPTHS', depths) +
    codexSection('THE CHRONICLE', chronicle) +
    codexSection('POWERS OF THE WORLD', powers) +
    codexSection('THOSE YOU HAVE MET', cast);
}

/* ---------------- library ---------------- */
function allThatCleared(clearedCount, reg) {
  const lines = [];
  if (clearedCount >= 3) lines.push('The Lore-Weavers have awakened.');
  const n = (reg.dungeons || []).filter((d) => d && d.type === 'dungeon').length;
  if (n) lines.push('They have spun ' + n + ' new depth' + (n > 1 ? 's' : '') + '.');
  return lines.length ? lines.join(' ') : null;
}

function renderLibrary(g) {
  const p = g && g.state.player;
  if (!p) { els.libraryBlock.innerHTML = ''; return; }
  const done = (id) => g.isDungeonCleared(id);
  const cleared = ['temple', 'upper', 'serpent'].filter(done).length;
  const scrambled = allThatCleared(cleared, registry);
  els.libraryBlock.innerHTML =
    '<h3 class="pane">THE BLACK LIBRARY</h3>' +
    '<div class="lib-status">Base chronicle: ' + cleared + '/3 sanctums conquered. ' +
    (scrambled ? scrambled : 'Press the sigil below to petition the oracle.') +
    '</div>' +
    '<div class="row"><button id="btn-open-library">OPEN THE BLACK LIBRARY</button></div>';
  const b = els.libraryBlock.querySelector('#btn-open-library');
  if (b) b.onclick = () => openLibrary();
}

/* ---------------- keyboard & actions ---------------- */
function canvasFocus() { els.canvas.focus(); }

function onKey(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (game) setTab(nextTab());
    return;
  }
  if (!game) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = String(e.key).toLowerCase();
  if (k >= '1' && k <= '9') {
    const idx = Number(k) - 1;
    const ab = game.allAbilities();
    if (ab[idx] && ab[idx].kind !== 'passive') { game.handleKey(null, { ability: ab[idx].id }); e.preventDefault(); }
    return;
  }
  if (k === '?' || k === 'h') { helpOpen ? closeHelp() : showHelp(); e.preventDefault(); return; }
  if (k === 'i' || k === 'e') { setTab('gear'); e.preventDefault(); return; }
  if (k === 'c') { setTab('codex'); e.preventDefault(); return; }
  if (k === 'l') { setTab('library'); e.preventDefault(); return; }
  if (k === 'escape') { if (helpOpen) closeHelp(); else closeDialogue(); return; }
  if (k === 'enter') {
    if (dialogueOpen) { dlgSend(); }
    return;
  }
  if (game) { game.handleKey(e.key, {}); e.preventDefault(); saveGame(); }
}

function nextTab() {
  const tabs = ['stats', 'gear', 'codex', 'library'];
  return tabs[(tabs.indexOf(currentTab) + 1) % tabs.length];
}

let dialogueOpen = false;
let activeNpc = null;
let helpOpen = false;

function closeHelp() {
  helpOpen = false;
  overlayHideAll();
  canvasFocus();
}

function openDialogue(npc) {
  const tpl = npc && npc.tpl ? npc.tpl : npc;
  if (game && tpl && tpl.id) game.introduceNpc(tpl.id);
  activeNpc = tpl;
  dialogueOpen = true;
  els.dlgName.textContent = tpl.name + ' — ' + (tpl.title || 'a denizen of the dark');
  els.dlgLog.innerHTML = '';
  const hist = dialogue.start(tpl);
  for (const m of hist) appendDlg(m);
  els.dlgInput.value = '';
  overlayShow(els.dialogue);
  setTimeout(() => els.dlgInput.focus(), 30);
}

function appendDlg(m) {
  const d = document.createElement('div');
  d.className = 'msg ' + (m.role === 'npc' ? 'n' : 'c');
  d.textContent = (m.role === 'npc' ? (activeNpc ? activeNpc.name + ': ' : '') : 'You: ') + m.text;
  els.dlgLog.appendChild(d);
  els.dlgLog.scrollTop = els.dlgLog.scrollHeight;
}

function closeDialogue() {
  if (!dialogueOpen) return;
  dialogueOpen = false;
  activeNpc = null;
  els.dialogue.classList.add('hidden');
  els.overlay.classList.add('hidden');
  canvasFocus();
}

async function dlgSend() {
  const input = (els.dlgInput.value || '').trim();
  if (!input || !activeNpc) return;
  els.dlgInput.value = '';
  const hist = await dialogue.talk(activeNpc, game.state.player, input);
  els.dlgLog.innerHTML = '';
  for (const m of hist) appendDlg(m);
}

/* ---------------- save / load ---------------- */
function saveGame() {
  if (!game || !game.state || !game.state.player) return;
  try {
    const data = { v: 1, saved: Date.now(), state: game.save(), registry };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}

function doContinue() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { beginCreate(); return; }
    const data = JSON.parse(raw);
    if (data.registry) registry = data.registry;
    persistRegistry();
    const g = makeGame();
    g.restore(data.state);
    overlayHideAll();
    startGame(g);
    g.loadFloor(g.state.player.floorIdx);
    saveGame();
  } catch (e) {
    logLine('The record is lost: ' + (e.message || 'cannot read the ledger'), 'combat');
    beginCreate();
  }
}

function doResurrect() {
  overlayHideAll();
  game.returnToCamp(true);
  saveGame();
}

function doRoster() {
  overlayHideAll();
  els.boot.classList.remove('hidden');
  els.overlay.classList.remove('hidden');
  setBootNote();
}

/* ---------------- library overlay & expansions ---------------- */
const EXP_ACTIONS = [
  ['dungeon', 'FOUND A NEW DUNGEON'],
  ['monster', 'SPEAK A MONSTER'],
  ['item', 'ENCHANT AN ITEM'],
  ['ability', 'GRANT AN ABILITY'],
];

function openLibrary() {
  els.libResult.innerHTML = '';
  els.libStatus.textContent = llmConfigured
    ? 'The oracle is awake (' + (window.__lapsaiModel || '') + '). Bound new depths to the world.'
    : 'No oracle is configured (set OPENAI_API_KEY and restart). Scribes offer candlelight placeholder only.';
  els.libActions.innerHTML = EXP_ACTIONS.map(([a, label]) =>
    '<button data-act="' + a + '">' + label + '</button>').join('');
  overlayShow(els.libOverlay);
}

/* The engine reads `props`. Expansions written before the content contract
 * existed carry `properties`; accept both so old data still behaves. */
function normaliseMonster(m) {
  if (!m || typeof m !== 'object') return m;
  if (!Array.isArray(m.props) && Array.isArray(m.properties)) {
    return { ...m, props: m.properties };
  }
  return m;
}

function installExpansion(exp) {
  if (!exp || typeof exp !== 'object') return false;
  const type = exp.type || exp._t;
  if (type === 'dungeon') {
    const id = exp.id || ('exp-' + Math.random().toString(36).slice(2, 8));
    if (registry.dungeons.some((d) => d.id === id)) return true;
    const monsters = (exp.monsters || []).map((m, i) => ({ ...normaliseMonster(m), id: id + '-m' + i, type: 'monster' }));
    const boss = exp.boss ? { ...normaliseMonster(exp.boss), id: id + '-boss', type: 'monster' } : null;
    if (boss) registry.monsters = registry.monsters.filter((m) => m.id !== boss.id);
    if (boss) registry.monsters.push(boss);
    for (const m of monsters) {
      registry.monsters = registry.monsters.filter((x) => x.id !== m.id);
      registry.monsters.push(m);
    }
    registry.dungeons.push({
      id, type: 'dungeon',
      name: exp.name, title: exp.title, flavor: exp.flavor,
      floors: exp.floors || 3, theme: exp.theme || 'temple', threat: exp.threat || 0,
      monsterWeights: [...monsters.map((m) => m.id), boss ? boss.id : null].filter(Boolean),
      bossId: boss ? boss.id : null,
      requires: exp.requires || 'temple',
    });
    return true;
  }
  if (type === 'monster') {
    const id = exp.id || ('exp-' + Math.random().toString(36).slice(2, 8));
    registry.monsters = registry.monsters.filter((m) => m.id !== id);
    registry.monsters.push({ ...normaliseMonster(exp), id, type: 'monster' });
    return true;
  }
  if (type === 'item') {
    const id = exp.id || ('exp-' + Math.random().toString(36).slice(2, 8));
    registry.items = registry.items.filter((i) => i.id !== id);
    registry.items.push({ ...exp, id, type: 'item' });
    return true;
  }
  if (type === 'ability') {
    const id = exp.id || ('exp-' + Math.random().toString(36).slice(2, 8));
    registry.abilities = registry.abilities.filter((a) => a.id !== id);
    registry.abilities.push({ ...exp, id, type: 'ability' });
    return true;
  }
  return false;
}

async function fetchExpansions() {
  try {
    const res = await fetch('/api/expansions', { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) return;
    const list = await res.json();
    let changed = false;
    for (const e of list) changed = installExpansion(e) || changed;
    if (changed) persistRegistry();
  } catch (e) { /* offline */ }
}

async function doExpand(action) {
  els.libResult.innerHTML = '<div class="lib-status">The quills are scraping…</div>';
  const focus = (els.libFocus.value || '').trim();
  try {
    const p = game && game.state.player;
    const bodyContext = { focus };
    /* Tell the oracle who is asking, so what it writes is worth meeting. */
    if (p) {
      bodyContext.depth = p.level;
      if (action === 'ability') bodyContext.cls = p.cls;
      const d = game.dungeonById(p.dungeonId);
      if (d && d.theme) bodyContext.theme = d.theme;
      bodyContext.existing = game.availableDungeons().map((x) => x && x.name).filter(Boolean).join(', ');
    }
    const res = await fetch('/api/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, context: bodyContext }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      els.libResult.innerHTML = '<div class="lib-status" style="color:var(--red)">The oracle is silent: ' + (data.error || res.statusText || 'unknown error') + '</div>' +
        (res.status === 503 ? '<p class="tiny">Set OPENAI_API_KEY (or config.json) and restart the server to awaken the oracle.</p>' : '');
      return;
    }
    const exp = data.expansion;
    if (installExpansion(exp)) {
      persistRegistry();
      logLine('The Library certifies a new work: ' + (exp.name || exp.type || 'a binding'), 'good');
      els.libResult.innerHTML = '<div class="expansion-card"><b>' + (exp.name || 'New ' + (exp.type || 'content')) + '</b>' +
        '<p class="flavor">' + (exp.flavor || (exp.description || '')) + '</p></div>';
      if (exp.type === 'dungeon') logLine('A dungeon unfolds on the map: ' + exp.name, 'gold');
    } else {
      els.libResult.innerHTML = '<div class="lib-status">The worked page is blank.</div>';
    }
    if (game) { renderCodex(game); renderLibrary(game); if (currentTab === 'gear') renderGear(game); }
  } catch (e) {
    els.libResult.innerHTML = '<div class="lib-status" style="color:var(--red)">Scribes fumbled: ' + (e.message || e) + '</div>';
  }
}

/* ---------------- boot & init ---------------- */
function setBootNote() {
  els.saveNote.textContent = hasSave()
    ? 'A record lies in the archive — the expedition may resume.'
    : 'No archive yet. Forge a new soul.';
  const cv = document.getElementById('btn-continue');
  cv.style.display = hasSave() ? '' : 'none';
}

async function boot() {
  loadRegistry();
  try {
    const res = await fetch('/api/status', { headers: { 'Content-Type': 'application/json' } });
    if (res.ok) {
      const s = await res.json();
      llmConfigured = !!s.llmConfigured;
      window.__lapsaiModel = s.model || '';
    }
  } catch (e) { /* offline */ }
  await fetchExpansions();

  els.btnNew.onclick = () => beginCreate();
  els.btnContinue.onclick = () => doContinue();
  els.btnReroll.onclick = () => { rolled = rollStats(); paintAttrs(); };
  els.btnEnter.onclick = () => doEnter();
  els.charName.addEventListener('keydown', (e) => { if (e.key === 'Enter') doEnter(); });
  els.btnResurrect.onclick = () => doResurrect();
  els.btnRoster.onclick = () => doRoster();
  els.btnArrivalOk.onclick = () => nextCard();
  els.btnVictoryOk.onclick = () => { clearCards(); doRoster(); };
  els.btnLibClose.onclick = () => { overlayHideAll(); canvasFocus(); };
  els.btnHelp.onclick = () => showHelp();
  els.btnHelpClose.onclick = () => closeHelp();
  els.dlgSend.onclick = () => dlgSend();
  els.dlgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlgSend(); } });

  els.libActions.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) doExpand(b.dataset.act);
  });

  document.querySelectorAll('#sheets-tabs .tab').forEach((t) => {
    t.onclick = () => setTab(t.dataset.tab);
  });

  els.equipmentBlock.addEventListener('click', equipmentClick);
  els.inventoryBlock.addEventListener('click', inventoryClick);
  els.inventoryBlock.addEventListener('contextmenu', (e) => { inventDrop(e); e.preventDefault(); });
  els.beltBlock.addEventListener('click', beltClick);

  window.addEventListener('resize', () => { fitCanvas(); if (game) renderGame(game); });
  document.addEventListener('keydown', onKey);
  const anim = setInterval(() => { if (game && !document.hidden) renderGame(game); }, 600);
  document.addEventListener('keydown', (e) => { if (e.key === 'F5' || (e.key === 's' && (e.metaKey || e.ctrlKey))) saveGame(); });

  setBootNote();
  els.overlay.classList.remove('hidden');
  els.boot.classList.remove('hidden');
}

/* ---------------- gear click handlers ---------------- */
function equipmentClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || !game) return;
  if (b.dataset.act === 'unequip') { game.unequip(b.dataset.slot); renderGear(game); renderStats(game); saveGame(); canvasFocus(); }
}

function inventoryClick(e) {
  const b = e.target.closest('button');
  if (!b || !game) return;
  const p = game.state.player;
  if (b.dataset.drop !== undefined) {
    game.drop(p.inventory[Number(b.dataset.drop)]);
  } else if (b.dataset.inv !== undefined) {
    game.useItem(p.inventory[Number(b.dataset.inv)]);
  }
  renderGear(game); renderStats(game); saveGame(); canvasFocus();
}

function inventDrop(e) {
  const b = e.target && e.target.closest && e.target.closest('button[data-inv]');
  if (!b || !game) return;
  game.drop(game.state.player.inventory[Number(b.dataset.inv)]);
  renderGear(game); renderStats(game); saveGame();
}

function beltClick(e) {
  const b = e.target.closest('[data-belt]');
  if (!b || !game) return;
  game.setBelt(Number(b.dataset.belt), null);
  renderGear(game); saveGame(); canvasFocus();
}

boot();

