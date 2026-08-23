/* Temple Lapsai — main.js: UI controller.
 * Owns the DOM/canvas; every engine callback is routed through the `ui` object.
 */

import { Game, rollStats, initialStats, PACK_LIMIT } from './engine.js';
import { CLASSES, getTheme, abilityMod, XP_FOR_LEVEL, cls, itemStackKey, getDungeon } from './base.js';
import { T, W, H } from './mapgen.js';
import { dialogue, NPC_GLYPH } from './npc.js';
import { WORLD } from './world.js';
import { WEARABLE_SLOTS as WEARABLE, monsterTint, PLAYER_GLYPH } from './contract.js';
import { PROVIDERS, providerById } from './providers.js';
import { itemDescription, abilityHealNote, abilityPowerNote } from './describe.js';
import {
  LEGACY_SLOT, SLOT_PREFIX, newCharId, summarise, rememberCharacter, readCharacter,
  forgetCharacter, markFallen, pickLast, playable, adoptLegacySave,
} from './roster.js';

/* ---------------- constants ---------------- */
const REGISTRY_KEY = 'lapsai-registry';
/* The game has been renamed before and may be again. Rather than naming the
 * old keys — which would keep a retired name alive in the source — adopt any
 * save or registry left behind under a previous one, then clear it away. */
function migrateLegacyStorage() {
  try {
    for (const suffix of ['-save', '-registry']) {
      const current = suffix === '-save' ? LEGACY_SLOT : REGISTRY_KEY;
      for (const key of Object.keys(localStorage)) {
        if (key === current || key.startsWith(SLOT_PREFIX) || !key.endsWith(suffix)) continue;
        const carried = localStorage.getItem(key);
        if (carried !== null && localStorage.getItem(current) === null) {
          localStorage.setItem(current, carried);
        }
        localStorage.removeItem(key);
      }
    }
    /* And the single slot the game kept before it kept several becomes the
     * first name in the ledger rather than the thing the next adventurer
     * writes over. Resolve the dungeon's real name here, where the content is
     * in reach — the ledger itself only stores strings. */
    const old = JSON.parse(localStorage.getItem(LEGACY_SLOT) || 'null');
    const was = old && old.state && old.state.player;
    const d = was && getDungeon(was.dungeonId);
    adoptLegacySave(localStorage, newCharId(Date.now(), Math.random()),
      was ? summarise(was, d && d.name) : null, Date.now());
  } catch (e) { /* private mode, quota, an indifferent browser */ }
}

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('game'),
  ctx: $('game').getContext('2d'),
  location: $('location'),
  topstatus: $('topstatus'),
  log: $('log'),
  hpFill: $('hp-fill'),
  hpWound: $('hp-wound'),
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
  oraclePanel: $('oracle-panel'),
  oracleProvider: $('oracle-provider'),
  oracleModel: $('oracle-model'),
  oracleModels: $('oracle-models'),
  oracleBase: $('oracle-base'),
  oracleKey: $('oracle-key'),
  oracleNote: $('oracle-note'),
  btnOracleSave: $('btn-oracle-save'),
  btnOracleTest: $('btn-oracle-test'),
  btnOracleForget: $('btn-oracle-forget'),
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
  ledger: $('ledger'),
  ledgerList: $('ledger-list'),
  btnLedger: $('btn-ledger'),
  btnLedgerNew: $('btn-ledger-new'),
  btnLedgerClose: $('btn-ledger-close'),
};

/* The one list of controls: the help card is built from it, so what the game
 * tells you and what the game does cannot drift apart. */
const CONTROLS = [
  ['Getting about', [
    ['W A S D  ·  arrows', 'Walk one tile. Walk into a monster to attack it, into a door to open it, into a person to talk.'],
    ['Y U B N  ·  numpad', 'Walk a diagonal — Y and U up, B and N down. The numpad works too, with 5 to wait. You cannot cut a corner where two walls meet.'],
    ['Space  ·  X', 'Wait where you are and let the turn pass.'],
    ['R', 'Rest. Sit until your wounds close and your power comes back, or until something wakes.'],
    ['<  ·  >', 'Stairs. Step onto them to climb or descend — you cannot leave with something at your heels.'],
  ]],
  ['Reading the dark', [
    ['Anything red', 'Alive, and interested in you. The duller the red the milder the thing — rust and dark red are vermin, bright red and orange are trouble, and something the colour of a hot coal will kill you.'],
    ['@', 'You. Nothing else on the map is drawn this way.'],
    ['Everything else', 'Loot, doors, stairs and people. Nothing you can pick up is ever red.'],
  ]],
  ['Things on the ground', [
    ['G', 'Take what is underfoot. With nothing there, look around instead and see what lies within reach.'],
    ['$ ! ? = &  and other glyphs', 'Loot waiting to be picked up. Coins and treasure are taken automatically as you step on them.'],
    ['GEAR panel', 'Every item lists what it actually does under its name. Identical things stack.'],
  ]],
  ['Your character', [
    ['1 – 9', 'Use the matching power from the STAT SHEET.'],
    ['I  ·  E', 'Gear: wear, use, and drop what you are carrying. Right-click an item to drop it.'],
    ['Shift + 1 – 4', 'Use what is on that belt loop. Bind something to the belt with BELT in the gear panel.'],
    ['C', 'Codex: the depths you know about.'],
    ['L', 'The Black Library, where new depths get written.'],
    ['Tab', 'Cycle those four panels.'],
  ]],
  ['Talking and dialogs', [
    ['Enter', 'Start the game, or send a line of dialogue.'],
    ['OTHER ADVENTURERS', 'On the title card: everyone you have sent down. Play any of them, or erase one. Whoever went down last is who CONTINUE opens.'],
    ['Esc', 'Leave a conversation.'],
    ['?  ·  H', 'This card.'],
  ]],
];

/* ---------------- state ---------------- */
let game = null;
let currentTab = 'stats';
let selClass = 'fighter';
let rolled = null;
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
      logLine('A new path is opened: ' + d.name + ' — ' + (d.title || ''), 'good');
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
  /* One card at a time. Showing a card without hiding the others is what put
   * the Black Library on screen beside a story beat, and four CAMP cards in a
   * row — every path that shows a card comes through here, so the rule belongs
   * here rather than in each of them. */
  for (const card of els.overlay.querySelectorAll('.overlay-card')) {
    if (card !== el) card.classList.add('hidden');
  }
  els.overlay.classList.remove('hidden');
  el.classList.remove('hidden');
}
function overlayHideAll() {
  els.overlay.classList.add('hidden');
  // Query rather than list ids: the camp card is built at runtime, and a card
  // left visible reappears under the next overlay that opens.
  for (const card of els.overlay.querySelectorAll('.overlay-card')) card.classList.add('hidden');
  /* getElementById finds one. Anything that ever managed to build a second
   * camp card would leave it on screen forever. */
  for (const camp of els.overlay.querySelectorAll('#camp-card')) camp.remove();
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
  /* Recorded on the ledger rather than in the save, which is deliberately not
   * written on the killing blow. Rising again clears it, and so does opening
   * the record from the ledger — at the same price. */
  markFallen(localStorage, charId, true);
  overlayHideAll();
  els.deathMsg.textContent = msg || 'You were laid low in the dark.';
  overlayShow(els.death);
}

function showCamp(g) {
  /* Camp is a place, not an event: arriving at it twice must not put two
   * cards on the screen side by side. */
  for (const old of els.overlay.querySelectorAll('#camp-card')) old.remove();
  const box = document.createElement('div');
  box.id = 'camp-card';
  box.className = 'overlay-card';
  box.innerHTML =
    '<h2>CAMP</h2>' +
    /* It used to claim your wounds knit and your purse lightened. Neither was
     * true: the healing was DESCENT_RECOVERY firing on the way back in, which
     * is now paid only for going down, and nothing here ever took a coin. */
    '<p class="sub">Warm firelight, and the road back down. Choose a path:</p>' +
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
  box.querySelector('#btn-camp-close').onclick = () => { overlayHideAll(); box.remove(); g.loadFloor(g.state.player.floorIdx, 'keep'); };
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
  /* A fresh record. Without this, rolling someone new saved over whoever the
   * last save belonged to — which is the whole of what this replaces. */
  charId = null;
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
    /* Under the surface, and not drawn until it breaks it — unless something
     * has revealed it, because Detect Evil promises every monster on the floor
     * and quietly missing the ones lying in the drains is a lie the player
     * would only find out about by dying to one. Drawn dim: you know it is
     * there, you cannot see it properly. */
    if (m.submerged && !m.revealed) continue;
    if (!inView(m.x, m.y) && !m.revealed) continue;
    /* Tinted by tier, never by name: red on this map is always something
     * alive. Loot is drawn from a palette with no red in it. */
    drawGlyph(m.x, m.y, m.t.glyph, cls(monsterTint(m.t.tier, m.boss)), !inView(m.x, m.y) || m.submerged);
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
    drawGlyph(p.x, p.y, PLAYER_GLYPH, '#f0f0e0', false, true);
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
  /* The part of the bar resting cannot reach, hatched off at the top. Without
   * it a heal that stops short reads as a bug rather than as a wound. */
  if (els.hpWound) {
    const cap = g.restedCap(p);
    const lost = Math.max(0, p.maxhp - cap);
    els.hpWound.style.width = (100 * lost / Math.max(1, p.maxhp)) + '%';
    els.hpWound.style.display = lost > 0 ? '' : 'none';
  }
  els.topstatus.textContent = p.name + ' · Lv ' + p.level + ' · ' + p.hp + '/' + p.maxhp + ' hp' +
    (p.wounds > 0 ? ' (' + p.wounds + ' wounded)' : '') +
    ' · ' + p.power + '/' + p.maxpower + ' pwr · ' + p.gold + ' gp';
}

/* ---------------- stat sheet ---------------- */
function buffLines(p) {
  const out = [];
  if (p.buffs.turn > 0) out.push('Turned Undead (' + p.buffs.turn + ')');
  if (p.buffs.sanctuary > 0) out.push('Sanctuary (' + p.buffs.sanctuary + ')');
  if (p.buffs.str > 0) out.push('Strength Boost (lvl ' + p.buffs.str + ')');
  if (p.buffs.might > 0) out.push('Sharpened (+' + ((p.buffLevels && p.buffLevels.might) || 2) + ' to hit, ' + p.buffs.might + ')');
  if (p.buffs.ward > 0) out.push('Warded (' + ((p.buffLevels && p.buffLevels.ward) || 1) + ' turned aside, ' + p.buffs.ward + ')');
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
  kv('Name', esc(p.name));
  kv('Class', c.name + ' (' + c.glyph + ')');
  kv('Level', p.level);
  kv('XP', p.xp + ' / next ' + toNext);
  kv('Gold', p.gold + ' gp');
  kv('HP', p.hp + ' / ' + p.maxhp);
  if (p.wounds > 0) {
    kv('Wounded', p.wounds + ' <span class="tiny">rest reaches ' + g.restedCap(p) + '</span>');
  }
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
    /* A healing power beats its own die roll when you are big enough, so the
     * floor is appended rather than trusted to the description — which covers
     * the ones the Library writes as well as the four that shipped. */
    const heals = abilityHealNote(a, { maxhp: p.maxhp });
    const renews = abilityPowerNote(a, { maxpower: p.maxpower });
    el.innerHTML = '<b>[' + (i + 1) + '] ' + esc(a.name) + '</b>' +
      (a.kind === 'passive' ? ' <span class="tiny">passive</span>'
        /* "0 pwr" reads as broken. A working that costs nothing is at will. */
        : ' <span class="tiny">' + (a.powerCost ? a.powerCost + ' pwr' : 'at will') +
          (a.cooldown ? ' · cd ' + a.cooldown : '') + '</span>') +
      (a.level > 1 ? ' <span class="tiny">Lv' + a.level + '</span>' : '') +
      (cd > 0 ? ' <b style="color:var(--red-dim)">(' + cd + ')</b>' : '') +
      '<div class="desc">' + esc(a.description || '') +
      (heals ? ' <span class="tiny">(' + esc(heals) + ')</span>' : '') +
      (renews ? ' <span class="tiny">(' + esc(renews) + ')</span>' : '') + '</div>';
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

/* What the button will actually do, so the label cannot lie. useItem checks
 * kind before slot, so a wand in the pack fires rather than being worn. */
function itemVerb(it) {
  if (!it) return 'USE';
  if (it.kind === 'wand') return 'FIRE';
  return WEARABLE.includes(it.slot) ? 'WEAR' : 'USE';
}

/* Interchangeable things share one row. The pack keeps holding individual
 * objects — uids, curses and charges all still belong to a single potion —
 * this only collapses the ones a player would never want to tell apart.
 * First-seen order is kept so the pack does not reshuffle as you pick things
 * up. */
function stackInventory(inv) {
  const groups = [];
  const byKey = new Map();
  inv.forEach((it, i) => {
    if (!it) return;
    const key = itemStackKey(it);
    const found = byKey.get(key);
    if (found) { found.indices.push(i); return; }
    const grp = { key, item: it, indices: [i] };
    byKey.set(key, grp);
    groups.push(grp);
  });
  return groups;
}

/* The rules under the name. Flavour goes in the tooltip: it is lovely and it
 * is not what you are deciding on. */
function descRow(it, p) {
  const d = itemDescription(it, { maxhp: p && p.maxhp });
  return d ? '<div class="i-desc">' + esc(d) + '</div>' : '';
}

function flavorTitle(it) {
  return it && it.flavor ? ' title="' + esc(it.flavor).replace(/"/g, '&quot;') + '"' : '';
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
      '<span class="i-name' + (it && it.cursed ? ' cursed' : mag ? ' mag' : '') + '"' + flavorTitle(it) + '>' +
      (it ? esc(it.name) : '—') + '</span>' +
      (it ? '<button data-act="unequip" data-slot="' + slot + '">TAKE OFF</button>' : '') +
      '</div>' + descRow(it, p);
  }
  els.equipmentBlock.innerHTML = '<h3 class="pane">EQUIPPED</h3>' + html;

  const inv = p.inventory || [];
  const onBelt = (it) => (p.belt || []).some((e) => e && (typeof e === 'string' ? e : e.uid) === it.uid);
  const ih = stackInventory(inv).map((grp) => {
    const it = grp.item;
    /* Bind and drop act on a copy that is not already on the belt, so a stack
     * of three potions can put one in a loop and keep two in the pack. */
    const free = grp.indices.find((i) => !onBelt(inv[i]));
    return '<div class="eq-row"><span class="ico">' + itemIcon(it) + '</span>' +
      '<span class="i-name' + (it.cursed ? ' cursed' : '') + '"' + flavorTitle(it) + '>' + esc(it.name) +
      (grp.indices.length > 1 ? ' <b class="qty">&times;' + grp.indices.length + '</b>' : '') + '</span>' +
      '<button data-inv="' + grp.indices[0] + '">' + itemVerb(it) + '</button>' +
      (free === undefined ? '' : '<button data-bind="' + free + '">BELT</button>') +
      '<button data-drop="' + (free === undefined ? grp.indices[0] : free) + '">DROP</button></div>' +
      descRow(it, p);
  }).join('');
  els.inventoryBlock.innerHTML = '<h3 class="pane">PACK (' + inv.length + '/' + PACK_LIMIT + ')</h3>' +
    (ih || '<div class="tiny">You carry nothing.</div>');

  let belt = '';
  const b = p.belt || [null, null, null, null];
  for (let i = 0; i < b.length; i++) {
    const it = g.beltItem(i);
    belt += '<div class="eq-row"><span class="slot">⇧' + (i + 1) + '</span>' +
      '<span class="ico">' + (it ? itemIcon(it) : '·') + '</span>' +
      '<span class="i-name">' + (it ? esc(it.name) : '—') + '</span>' +
      (it ? '<button data-use-belt="' + i + '">USE</button><button data-belt="' + i + '">UNBIND</button>' : '') + '</div>';
  }
  els.beltBlock.innerHTML = '<h3 class="pane">BELT <span class="tiny">shift + 1-4</span></h3>' + belt;
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
    (oracle && oracle.ready ? '' : ' <b>No oracle is bound.</b>') +
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
  const cardUp = !els.overlay.classList.contains('hidden');
  if (e.shiftKey && e.code && /^Digit[1-4]$/.test(e.code) && !cardUp) {
    game.handleKey(null, { belt: Number(e.code.slice(5)) - 1 });
    renderGear(game); renderStats(game); saveGame();
    e.preventDefault();
    return;
  }
  const NUMPAD = {
    Numpad1: [-1, 1], Numpad2: [0, 1], Numpad3: [1, 1],
    Numpad4: [-1, 0], Numpad6: [1, 0],
    Numpad7: [-1, -1], Numpad8: [0, -1], Numpad9: [1, -1],
  };
  if (e.code && NUMPAD[e.code] && !cardUp) {
    const [ndx, ndy] = NUMPAD[e.code];
    game.handleKey(null, { dx: ndx, dy: ndy });
    if (currentTab === 'gear') renderGear(game);
    e.preventDefault();
    saveGame();
    return;
  }
  if (e.code === 'Numpad5' && !cardUp) { game.handleKey(' ', {}); e.preventDefault(); saveGame(); return; }

  if (k >= '1' && k <= '9') {
    const idx = Number(k) - 1;
    const ab = game.allAbilities();
    if (ab[idx] && ab[idx].kind !== 'passive') {
      game.handleKey(null, { ability: ab[idx].id });
      /* This branch never saved, so every power spent, cooldown started and
       * wound healed by an ability was lost on the next reload. */
      if (currentTab === 'gear') renderGear(game);
      saveGame();
      e.preventDefault();
    }
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
  /* Every branch above this one already refused to fire behind a card; this
   * one did not, so arrow keys walked the player around underneath the camp,
   * arrival and death overlays — taking real turns you could not see. On the
   * up-stairs that meant a second CAMP card for every step. */
  if (cardUp) return;
  if (game) {
    game.handleKey(e.key, {});
    /* Picking something up from the keyboard changed the pack and left the
     * gear panel showing the pack from before. */
    if (currentTab === 'gear') renderGear(game);
    e.preventDefault();
    saveGame();
  }
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

/* Whose record the next save writes to. Set when an adventurer is rolled and
 * when one is opened; a save with nobody named would be the old single-slot
 * behaviour wearing a new key. */
let charId = null;

function saveGame() {
  if (!game || !game.state || !game.state.player) return;
  /* Not mid-death. The save fires on the keystroke that kills you, so writing
   * it here is what let a reload resume alive at zero hit points. */
  if (game.dying) return;
  if (!charId) charId = newCharId(Date.now(), Math.random());
  try {
    const p = game.state.player;
    const d = game.dungeonById(p.dungeonId);
    const data = { v: 2, id: charId, saved: Date.now(), state: game.save(), registry };
    rememberCharacter(localStorage, charId, data, summarise(p, d && d.name), data.saved);
  } catch (e) { /* ignore */ }
}

function hasSave() {
  return playable(localStorage).length > 0;
}

function doContinue() {
  const id = pickLast(localStorage);
  if (!id) { beginCreate(); return; }
  openCharacter(id);
}

/* Opening someone's record. A fallen adventurer is hauled back the same way
 * the death card does it — half their gold — because the save was written
 * before the killing blow, so simply loading one would be a free rise. */
function openCharacter(id) {
  const entry = playable(localStorage).find((c) => c.id === id);
  const data = readCharacter(localStorage, id);
  if (!data || !data.state) {
    logLine('That record is gone from the ledger.', 'combat');
    setBootNote();
    return;
  }
  try {
    if (data.registry) registry = data.registry;
    persistRegistry();
    const g = makeGame();
    g.restore(data.state);
    charId = id;
    overlayHideAll();
    startGame(g);
    if (entry && entry.fallen) {
      markFallen(localStorage, id, false);
      g.returnToCamp(true);
    } else {
      /* Resuming, not arriving: a reload used to put you back on the stairs,
       * which lost your place and — since a floor rebuilds its monsters from
       * the seed — was a way to walk out of a fight you were losing. */
      g.loadFloor(g.state.player.floorIdx, 'keep');
    }
    saveGame();
  } catch (e) {
    logLine('The record is lost: ' + (e.message || 'cannot read the ledger'), 'combat');
    beginCreate();
  }
}

function doResurrect() {
  overlayHideAll();
  markFallen(localStorage, charId, false);
  game.returnToCamp(true);
  saveGame();
}

function doRoster() {
  overlayHideAll();
  els.boot.classList.remove('hidden');
  els.overlay.classList.remove('hidden');
  setBootNote();
}

/* ---------------- the ledger ---------------- */

function whenSaved(ms) {
  if (!ms) return 'never';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
  const days = Math.floor(hours / 24);
  return days + ' day' + (days === 1 ? '' : 's') + ' ago';
}

function renderLedger() {
  const chars = playable(localStorage);
  els.ledgerList.innerHTML = chars.length ? chars.map((c) => {
    const cls = (CLASSES[c.cls] || {}).name || c.cls;
    const here = c.where ? esc(c.where) + ' · floor ' + (c.floor || 1) : 'not yet gone down';
    return '<div class="ledger-row' + (c.fallen ? ' fallen' : '') + '">' +
      '<span class="who"><b>' + esc(c.name) + '</b> <span class="tiny">' + esc(cls) + ' · level ' + (c.level || 1) +
      (c.fallen ? ' · <b>FALLEN</b>' : '') + '</span>' +
      '<span class="where">' + here + ' · ' + (c.gold || 0) + ' gp · saved ' + whenSaved(c.savedAt) + '</span></span>' +
      '<button data-open="' + esc(c.id) + '">' + (c.fallen ? 'RAISE (half your gold)' : 'PLAY') + '</button>' +
      '<button data-forget="' + esc(c.id) + '">ERASE</button>' +
      '</div>';
  }).join('') : '<div class="tiny">Nobody has gone down yet.</div>';
  overlayShow(els.ledger);
}

function ledgerClick(e) {
  const open = e.target.closest('[data-open]');
  if (open) { openCharacter(open.dataset.open); return; }
  const forget = e.target.closest('[data-forget]');
  if (!forget) return;
  const id = forget.dataset.forget;
  const row = forget.closest('.ledger-row');
  /* Erasing is the one thing here that cannot be undone, so it asks. */
  if (row && row.dataset.sure !== '1') {
    row.dataset.sure = '1';
    forget.textContent = 'ERASE FOR GOOD?';
    return;
  }
  forgetCharacter(localStorage, id);
  if (charId === id) charId = null;
  renderLedger();
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
  els.libActions.innerHTML = EXP_ACTIONS.map(([a, label]) =>
    '<button data-act="' + a + '">' + label + '</button>').join('');
  paintOracle();
  overlayShow(els.libOverlay);
  /* Ask again on the way in: the oracle may have been bound from a different
   * tab, or the server restarted since boot. */
  refreshOracle();
}

/* ---------------- the oracle ---------------- *
 *
 * The panel used to be one line of text telling you to set an environment
 * variable and restart, above four buttons that would fail if you had not.
 * Everything it needs is here now, and nothing it changes needs a restart.
 */

/* What the server last told us. `null` means we have not managed to ask. */
let oracle = null;

function fillProviderMenu() {
  if (els.oracleProvider.options.length) return;
  els.oracleProvider.innerHTML = PROVIDERS.map((p) =>
    '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('');
}

/* Picking a provider fills in its endpoint and a model to start from, but only
 * over fields the player has not already made their own — retyping the model
 * every time you glance at the menu would be its own small hell. */
function onProviderPicked() {
  const p = providerById(els.oracleProvider.value);
  if (!p) return;
  const prev = oracle && oracle.current;
  const sameAsBound = prev && prev.provider === p.id;
  els.oracleBase.value = sameAsBound ? prev.baseUrl : p.baseUrl;
  els.oracleModel.value = sameAsBound ? prev.model : (p.models[0] || '');
  paintProviderHints(p, sameAsBound ? prev : null);
}

function paintProviderHints(p, current) {
  els.oracleModels.innerHTML = (p.models || []).map((m) =>
    '<option value="' + esc(m) + '"></option>').join('');
  const needsKey = p.keyRequired !== false;
  els.oracleKey.disabled = !needsKey;
  els.oracleKey.placeholder = !needsKey
    ? 'not needed'
    : (current && current.hasKey ? 'kept (' + current.keyTail + ') — type to replace' : 'paste your key');
  els.oracleBase.readOnly = false;
  note(p.keyHint ? 'Keys: ' + p.keyHint : '', '');
}

function note(text, kind) {
  els.oracleNote.textContent = text || '';
  els.oracleNote.className = 'tiny' + (kind ? ' ' + kind : '');
}

/* One sentence in the summary line, because that is all you see when the panel
 * is folded away — and folded away is where it lives once it works. */
function paintOracle() {
  fillProviderMenu();
  const cur = oracle && oracle.current;
  if (!cur) {
    els.libStatus.textContent = 'not reachable — is the server running?';
    els.libStatus.className = 'lib-status unbound';
    setExpandEnabled(false);
    return;
  }
  els.oracleProvider.value = cur.provider;
  els.oracleBase.value = cur.baseUrl;
  els.oracleModel.value = cur.model;
  els.oracleKey.value = '';
  paintProviderHints(providerById(cur.provider) || PROVIDERS[0], cur);

  const ready = oracle.ready;
  const from = cur.source === 'environment' ? ' · from the environment' : '';
  els.libStatus.textContent = ready
    ? cur.label + ' · ' + cur.model + from
    : (cur.keyRequired && !cur.hasKey ? 'no key yet — bind one to wake it' : 'not bound yet');
  els.libStatus.className = 'lib-status ' + (ready ? 'bound' : 'unbound');
  els.oraclePanel.open = !ready;
  setExpandEnabled(ready);
}

function setExpandEnabled(on) {
  els.libActions.querySelectorAll('button').forEach((b) => { b.disabled = !on; });
  els.libFocus.disabled = !on;
}

async function refreshOracle() {
  try {
    const res = await fetch('/api/oracle', { headers: { 'Content-Type': 'application/json' } });
    oracle = res.ok ? await res.json() : null;
  } catch {
    oracle = null;
  }
  paintOracle();
}

async function postOracle(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'the Library refused that');
  return data;
}

async function bindOracle() {
  note('binding…', '');
  try {
    oracle = await postOracle('/api/oracle', {
      provider: els.oracleProvider.value,
      model: els.oracleModel.value.trim(),
      baseUrl: els.oracleBase.value.trim(),
      apiKey: els.oracleKey.value,
    });
    paintOracle();
    note('Bound. Test it, or commission a work.', 'good');
  } catch (e) {
    note(e.message || String(e), 'bad');
  }
}

/* BIND only writes down what you typed; TEST is the one that finds out whether
 * the key is real, the model name exists and the local server is running. */
async function testOracle() {
  note('asking…', '');
  try {
    const data = await postOracle('/api/oracle/test', {});
    if (data.ok) note('It answers: "' + String(data.reply || '').slice(0, 60) + '"', 'good');
    else note(data.error || 'no answer', 'bad');
  } catch (e) {
    note(e.message || String(e), 'bad');
  }
}

async function forgetOracle() {
  note('forgetting…', '');
  try {
    oracle = await postOracle('/api/oracle', { reset: true });
    paintOracle();
    note('Forgotten. Back to whatever the environment says.', '');
  } catch (e) {
    note(e.message || String(e), 'bad');
  }
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
      els.libResult.innerHTML = '<div class="lib-status" style="color:var(--red)">The oracle is silent: ' + esc(data.error || res.statusText || 'unknown error') + '</div>' +
        (res.status === 503 ? '<p class="tiny">Open THE ORACLE above and bind a provider — no restart needed.</p>' : '');
      if (res.status === 503) { els.oraclePanel.open = true; refreshOracle(); }
      return;
    }
    const exp = data.expansion;
    if (installExpansion(exp)) {
      persistRegistry();
      logLine('The Library certifies a new work: ' + (exp.name || exp.type || 'a binding'), 'good');
      els.libResult.innerHTML = '<div class="expansion-card"><b>' + esc(exp.name || 'New ' + (exp.type || 'content')) + '</b>' +
        '<p class="flavor">' + esc(exp.flavor || exp.description || '') + '</p></div>';
      if (exp.type === 'dungeon') logLine('A dungeon unfolds on the map: ' + exp.name, 'gold');
    } else {
      els.libResult.innerHTML = '<div class="lib-status">The worked page is blank.</div>';
    }
    if (game) { renderCodex(game); renderLibrary(game); if (currentTab === 'gear') renderGear(game); }
  } catch (e) {
    els.libResult.innerHTML = '<div class="lib-status" style="color:var(--red)">Scribes fumbled: ' + esc(e.message || e) + '</div>';
  }
}

/* ---------------- boot & init ---------------- */
function setBootNote() {
  const chars = playable(localStorage);
  const last = chars.find((c) => c.id === pickLast(localStorage));
  els.saveNote.textContent = !chars.length
    ? 'No archive yet. Forge a new soul.'
    : (last ? 'Last down: ' + last.name + ', ' + ((CLASSES[last.cls] || {}).name || last.cls) +
        ' of level ' + (last.level || 1) + (last.fallen ? ', fallen.' : '.') : '') +
      (chars.length > 1 ? '  ' + chars.length + ' in the ledger.' : '');
  els.btnContinue.style.display = chars.length ? '' : 'none';
  els.btnLedger.style.display = chars.length ? '' : 'none';
}

async function boot() {
  migrateLegacyStorage();
  loadRegistry();
  await refreshOracle();
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
  els.btnLedger.onclick = () => renderLedger();
  els.btnLedgerNew.onclick = () => beginCreate();
  els.btnLedgerClose.onclick = () => doRoster();
  els.ledgerList.addEventListener('click', ledgerClick);
  els.btnHelp.onclick = () => showHelp();
  els.btnHelpClose.onclick = () => closeHelp();
  els.dlgSend.onclick = () => dlgSend();
  els.dlgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlgSend(); } });

  els.libActions.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b && !b.disabled) doExpand(b.dataset.act);
  });
  els.oracleProvider.onchange = () => onProviderPicked();
  els.btnOracleSave.onclick = () => bindOracle();
  els.btnOracleTest.onclick = () => testOracle();
  els.btnOracleForget.onclick = () => forgetOracle();

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
  } else if (b.dataset.bind !== undefined) {
    game.bindToBelt(p.inventory[Number(b.dataset.bind)]);
  } else if (b.dataset.inv !== undefined) {
    game.useItem(p.inventory[Number(b.dataset.inv)]);
  }
  renderGear(game); renderStats(game); saveGame(); canvasFocus();
}

function inventDrop(e) {
  /* data-inv lives on one button in the row, so closest() from the row, the
   * name or either other button used to find nothing at all. */
  if (!game || !e.target || !e.target.closest) return;
  const row = e.target.closest('.eq-row');
  const b = row && row.querySelector('button[data-inv]');
  if (!b) return;
  game.drop(game.state.player.inventory[Number(b.dataset.inv)]);
  renderGear(game); renderStats(game); saveGame();
}

function beltClick(e) {
  const use = e.target.closest('[data-use-belt]');
  if (use && game) {
    game.useBeltItem(Number(use.dataset.useBelt));
    renderGear(game); renderStats(game); saveGame(); canvasFocus();
    return;
  }
  const b = e.target.closest('[data-belt]');
  if (!b || !game) return;
  game.setBelt(Number(b.dataset.belt), null);
  renderGear(game); saveGame(); canvasFocus();
}

boot();

