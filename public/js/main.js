/* Temple Lapsai — main.js: UI controller.
 * Owns the DOM/canvas; every engine callback is routed through the `ui` object.
 */

import { Game, rollStats, initialStats, PACK_LIMIT } from './engine.js';
import {
  CLASSES, getTheme, abilityMod, XP_FOR_LEVEL, cls, itemStackKey, getDungeon,
  BACKGROUNDS, backgroundById, SKILLS, skillById,
} from './base.js';
import { T, W, H, isTravelable } from './mapgen.js';
import { QUESTS, objectiveText } from './quests.js';
import { dialogue, NPC_GLYPH } from './npc.js';
import { WORLD, loreBriefing } from './world.js';
import { WEARABLE_SLOTS as WEARABLE, isWorn, abilityReach, monsterTint, PLAYER_GLYPH, partyTint } from './contract.js';
import { PROVIDERS, providerById } from './providers.js';
import {
  CREATURE_SHEETS, HERO_LAYERS, HERO_HEADS, parseAnimationDef, parseTilesetDef,
  creatureSheetUrl, creatureDefUrl, heroLayerUrl, heroDefUrl,
  tilesetUrl, tilesetDefUrl, loadImage,
} from './sprites.js';
import { findPath } from './path.js';
import { memberPortrait, npcPortrait } from './portraits.js';
import { ISO, isoToScreen, screenToIso, diamondPath, paintOrder, makeViewTest } from './iso.js';
import {
  PRICES, PARTY_LIMIT, shopStock, buyItem, sellPrice, sellItem,
  unreadItems, knownCurses, identifyItem, unbindCurse,
  raiseCost, fallenMembers, raiseMember,
  identifyCost, unbindCost, musterRoster, hireMember, innCost, takeRoom,
} from './town.js';
import { itemDescription, abilityHealNote, abilityPowerNote, abilityDamageNote } from './describe.js';
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
  iniBar: $('initiative-bar'),
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
  libSource: $('lib-source'),
  oraclePanel: $('oracle-panel'),
  oracleProvider: $('oracle-provider'),
  oracleModel: $('oracle-model'),
  oracleModels: $('oracle-models'),
  oracleBase: $('oracle-base'),
  oracleKey: $('oracle-key'),
  oracleNote: $('oracle-note'),
  btnOracleSave: $('btn-oracle-save'),
  btnOracleTest: $('btn-oracle-test'),
  btnOracleModels: $('btn-oracle-models'),
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
  dlgQuests: $('dlg-quests'),
  viewport: $('viewport'),
  help: $('help'),
  helpKeys: $('help-keys'),
  btnHelp: $('btn-help'),
  btnHelpClose: $('btn-help-close'),
  partyStrip: $('party-strip'),
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
    ['Mouse', 'Click somewhere seen and the company walks there; click a monster to close and strike; hover to see the route and name what waits. In a fight, one click is one action. Any key takes the reins back.'],
    ['V', 'Turn the view: the isometric scene, or the flat tactical map.'],
    ['+ − · wheel', 'Lean in or out of the scene.'],
    ['T', 'Kneel the walls: every stone cut to a stub, until you raise them again. For when the masonry is in the way of the war.'],
    ['In combat', 'A turn is ground AND a blow: move up to your speed, strike when you choose — the strike, or SPACE, ends the turn. Leaving a monster\'s reach gives it a free blow, except one single careful step. Stand on opposite sides of a thing and you flank it: +2 to hit, for them as for you.'],
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
/* A member's colour follows the MEMBER. `partyTint` still maps a slot to a
 * hue, but which slot belongs to whom is decided once, when they join, and
 * carried on the character — so redrawing the line does not repaint the
 * company. Falls back to position for anything that predates the field. */
function tintOf(m, fallbackIdx) {
  const slot = m && Number.isInteger(m.tint) ? m.tint : fallbackIdx;
  return partyTint(slot || 0);
}

/* Which member the sheets show. null follows whoever holds the reins; a
 * number is the player having pinned someone — arranging a companion's straps
 * mid-round is exactly what the strip is for. */
let viewedIdx = null;
let givingUid = null;   /* the pack item mid-hand-over, if any */

function viewedMember(g) {
  const members = g.state.party.members;
  if (viewedIdx !== null && members[viewedIdx] && members[viewedIdx].hp > 0) return members[viewedIdx];
  return g.state.player;
}
let selClass = 'fighter';
let selBackground = 'unremarked';
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
    /* The handle on window is a dev tool, the way the console always is in a
     * single-player game: it is how a bug report becomes a reproduction. */
    render: (g) => {
      game = g; window.lapsaiGame = g;
      /* The console's window into module scope: what tile a mouse event
       * lands on, and the route the click would take. Debugging surface
       * only — nothing in the game calls this. */
      window.lapsaiUI = { tileFromEvent, routeTo: (x, y) => routeTo(g, x, y), dialogueUp: () => dialogueOpen };
      renderGame(g); renderInitiative(g);
    },
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
      logLine('A new path is opened: ' + d.name + ' — its mouth stands in the Whetstone\u2019s east field.', 'good');
      renderCodex(game);
      renderLibrary(game);
    },
    flagNpcIntroduced: () => { if (currentTab === 'codex') renderCodex(game); },
    prepareTransition: () => { els.topstatus.textContent = '…descending…'; },
    /* WHERE TO COME IN. The stairs remember the deepest floor, which saves
     * re-walking swept halls — but the people who ask things of you live
     * near the entrance, and dropping in four floors below them turned
     * every hand-in into a climb. Ask. */
    askDepth: (d, known, go) => {
      const box = townCard('depth-card', d.name.toUpperCase(),
        'The stairs are known as far as floor ' + (known + 1) + '. The upper halls are swept — but the living are near the door.',
        '<div class="row">' +
          '<button id="btn-depth-deep">DOWN TO FLOOR ' + (known + 1) + '</button>' +
          '<button id="btn-depth-top">IN AT THE ENTRANCE</button>' +
        '</div>', 'NOT YET');
      box.querySelector('#btn-depth-deep').onclick = () => { overlayHideAll(); box.remove(); go(known); };
      box.querySelector('#btn-depth-top').onclick = () => { overlayHideAll(); box.remove(); go(0); };
    },
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
   * town card would leave it on screen forever. */
  for (const card of els.overlay.querySelectorAll('#camp-card, #shop-card, #sage-card, #muster-card')) card.remove();
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

/* THE WHETSTONE. Camp grew a town around it: the Provisioner buys and sells,
 * the Lector reads and unbinds, and gold finally has somewhere to go besides
 * the resurrection ledger. The card is rebuilt on every open so the purse and
 * the shelves are always current. */
function townCard(id, title, sub, bodyHtml, backLabel, face) {
  for (const old of els.overlay.querySelectorAll('#' + id)) old.remove();
  const box = document.createElement('div');
  box.id = id;
  box.className = 'overlay-card';
  box.innerHTML = (face ? '<img class="portrait-md" src="' + face + '" alt="">' : '') +
    '<h2>' + title + '</h2><p class="sub">' + sub + '</p>' + bodyHtml +
    '<div class="row"><button class="mini" data-town-back>' + backLabel + '</button></div>';
  els.overlay.appendChild(box);
  overlayShow(box);
  /* Every card gets a WORKING way back from birth; callers with somewhere
   * specific to go override this. The inn shipped without wiring its own,
   * and with the movement keys refused behind a card, the only way back
   * to the street was a page reload. */
  box.querySelector('[data-town-back]').onclick = () => {
    box.remove();
    if (game && game.inTown && game.inTown()) { overlayHideAll(); canvasFocus(); }
    else if (game) showCamp(game);
    else overlayHideAll();
  };
  return box;
}

function purseLine(g) {
  /* ONE PURSE for the company: it does not change hands when the reins
   * do, and the picker below chooses a PACK, never a wallet. */
  return '<div class="lib-status">Your purse: ' + g.purse() + ' gold.</div>';
}

function showCamp(g) {
  const company = g.state.party.members.filter(Boolean)
    .map((m) => esc(m.name) + ' <span class="tiny">' + esc((CLASSES[m.cls] || {}).name || m.cls) + ' ' + m.level +
      (m.hp <= 0 ? ' · fallen' : '') + '</span>').join(' &nbsp;·&nbsp; ');
  const box = townCard('camp-card', 'THE WHETSTONE',
    'Lamplight on wet cobbles, a ledger open on a table, and the stairs down. Nothing here is ancient — it is only poor.',
    purseLine(g) +
    '<div class="lib-status">The company: ' + company + '</div>' +
    '<div class="row">' +
      '<button id="btn-town-shop">THE PROVISIONER</button>' +
      '<button id="btn-town-sage">THE LECTOR</button>' +
      '<button id="btn-town-muster">THE MUSTER</button>' +
    '</div>' +
    '<h3 class="pane">THE STAIRS DOWN</h3><div id="camp-list"></div>',
    'ROAM AGAIN');
  const list = box.querySelector('#camp-list');
  for (const d of g.availableDungeons()) {
    const b = document.createElement('button');
    b.textContent = (g.isDungeonCleared(d.id) ? '[DONE] ' : '') + d.name + ' · ' + d.floors + ' floors';
    b.style.margin = '3px';
    b.onclick = () => { overlayHideAll(); box.remove(); g.enterDungeon(d.id); };
    list.appendChild(b);
  }
  box.querySelector('#btn-town-shop').onclick = () => { box.remove(); showShop(g); };
  box.querySelector('#btn-town-sage').onclick = () => { box.remove(); showSage(g); };
  box.querySelector('#btn-town-muster').onclick = () => { box.remove(); showMuster(g); };
  box.querySelector('[data-town-back]').onclick = () => { overlayHideAll(); box.remove(); g.loadFloor(g.state.player.floorIdx, 'keep'); };
}

function showShop(g, sellIdx) {
  const p = g.state.player;
  const party = g.state.party.members;
  if (sellIdx === undefined || !party[sellIdx]) sellIdx = Math.max(0, party.indexOf(p));
  const seller = party[sellIdx];
  const stock = shopStock(g).map((r) =>
    '<div class="eq-row"><span class="i-name">' + esc(r.name) + '</span>' +
    '<button data-buy="' + esc(r.id) + '"' + (g.purse() < r.price ? ' disabled' : '') + '>BUY · ' + r.price + ' gp</button></div>').join('');
  /* Whose pack is on the scale: any member's, the fallen included — their
   * gear travels with the company. The coin still lands in the purse at
   * the counter. */
  const chips = party.map((m, i) => m
    ? '<button class="mini" data-seller="' + i + '"' + (i === sellIdx ? ' disabled' : '') +
      ' style="color:' + tintOf(m, i) + ';border-color:' + tintOf(m, i) + '">' +
      esc(m.name) + (m.hp > 0 ? '' : ' †') + '</button>'
    : '').join(' ');
  /* Grouped like the pack: eight healing draughts are one row — sell one,
   * or the lot at once. Same stack key means same price, so the lot is
   * plain multiplication. */
  const groups = stackInventory(seller.inventory || []);
  const goods = groups.map((grp, gi) => {
    const it = grp.item, n = grp.indices.length;
    const price = sellPrice(it, g);
    return '<div class="eq-row"><span class="i-name' + (it.cursed && it.identified !== false ? ' cursed' : '') + '">' +
      esc(it.name) + (n > 1 ? ' <span class="tiny">×' + n + '</span>' : '') + '</span>' +
      '<span><button data-sell="' + gi + '">SELL' + (n > 1 ? ' 1' : '') + ' · ' + price + ' gp</button>' +
      (n > 1 ? ' <button data-sell-all="' + gi + '">ALL · ' + (price * n) + ' gp</button>' : '') + '</span></div>';
  }).join('');
  const box = townCard('shop-card', 'THE PROVISIONER',
    'Shelves of what the dungeon is stingy with, and a scale that weighs what you hauled up.',
    purseLine(g) +
    /* WHOSE PACK IS ON THE SCALE, decided before anything is read: the
     * picker sat in the GOODS header, below a shelf long enough to push
     * it off the card. It belongs at the top, where a choice is made. */
    (party.length > 1 ? '<div class="picker"><span class="tiny">On the scale:</span> ' + chips + '</div>' : '') +
    '<h3 class="pane">FOR SALE</h3><div class="scrolly" style="max-height:170px">' + stock + '</div>' +
    '<h3 class="pane">GOODS <span class="tiny">' + esc(seller.name) + '\u2019s pack</span></h3>' +
    '<div class="scrolly" style="max-height:170px">' +
      (goods || '<div class="tiny">' + (seller === p ? 'You carry' : esc(seller.name) + ' carries') + ' nothing worth weighing.</div>') + '</div>',
    'BACK TO THE STREET', npcPortrait('provisioner', 'female'));
  box.addEventListener('click', (e) => {
    const buy = e.target.closest('[data-buy]');
    if (buy) { buyItem(g, buy.dataset.buy, seller); saveGame(); renderHud(g); renderStats(g); box.remove(); showShop(g, sellIdx); return; }
    const who = e.target.closest('[data-seller]');
    if (who) { box.remove(); showShop(g, Number(who.dataset.seller)); return; }
    const all = e.target.closest('[data-sell-all]');
    if (all) {
      const grp = stackInventory(seller.inventory || [])[Number(all.dataset.sellAll)];
      if (grp) {
        /* The objects first, then the selling — each sale reshuffles the
         * indices under the group. */
        for (const it of grp.indices.map((i) => seller.inventory[i])) sellItem(g, it, seller);
      }
      saveGame(); renderHud(g); box.remove(); showShop(g, sellIdx); return;
    }
    const sell = e.target.closest('[data-sell]');
    if (sell) {
      const grp = stackInventory(seller.inventory || [])[Number(sell.dataset.sell)];
      if (grp) sellItem(g, grp.item, seller);
      saveGame(); renderHud(g); box.remove(); showShop(g, sellIdx);
    }
  });
  box.querySelector('[data-town-back]').onclick = () => {
    box.remove();
    /* From the walkable town you step back onto the green; the camp card
     * only exists where the town does not. */
    if (g.inTown && g.inTown()) { overlayHideAll(); canvasFocus(); } else showCamp(g);
  };
}

function showMuster(g) {
  const p = g.state.player;
  const full = g.state.party.members.length >= PARTY_LIMIT;
  const rows = full
    ? '<div class="tiny">The company is full — ' + PARTY_LIMIT + ' is as many as the stairs allow.</div>'
    : musterRoster(g).map((r) =>
        '<div class="eq-row"><span class="i-name"><b>' + esc(r.name) + '</b> <span class="tiny">' + esc(r.desc) + '</span></span>' +
        '<button data-hire="' + esc(r.id) + '"' + (g.purse() < r.cost ? ' disabled' : '') + '>HIRE · ' + r.cost + ' gp</button></div>').join('');
  const box = townCard('muster-card', 'THE MUSTER',
    'Sword-arms and scholars between engagements, seasoned to your own measure and priced for it.',
    purseLine(g) + '<div class="scrolly" style="max-height:280px">' + rows + '</div>',
    'BACK TO THE STREET', npcPortrait('muster', 'female'));
  box.addEventListener('click', (e) => {
    const hire = e.target.closest('[data-hire]');
    if (!hire) return;
    hireMember(g, hire.dataset.hire);
    saveGame(); renderHud(g); renderStats(g);
    box.remove(); showMuster(g);
  });
  box.querySelector('[data-town-back]').onclick = () => {
    box.remove();
    /* From the walkable town you step back onto the green; the camp card
     * only exists where the town does not. */
    if (g.inTown && g.inTown()) { overlayHideAll(); canvasFocus(); } else showCamp(g);
  };
}

function showInn(g) {
  const box = townCard('inn-card', 'THE DROWNED LANTERN',
    'Three rooms, one price, and the lamps kept lit until morning. The lantern over the door was pulled from the flooded floor.',
    purseLine(g) +
    '<div class="row"><button id="btn-inn-room">A ROOM FOR THE NIGHT · ' + innCost(g) + ' gp</button></div>' +
    '<div class="tiny">Beds and board: the whole company wakes healed, rested, and mended — wounds and all.</div>',
    'BACK TO THE STREET', npcPortrait('innkeep', 'male'));
  box.querySelector('#btn-inn-room').onclick = () => {
    if (takeRoom(g)) {
      saveGame();
      renderHud(g);
      renderStats(g);
      box.remove();
      showInn(g);
    }
  };
}

function showSage(g) {
  const unread = unreadItems(g);
  /* The Lector READS. The loosening moved up the lane to the Little
   * Temple — a reader who also unbinds is a temple with worse lighting. */
  const cursed = knownCurses(g);
  const rows =
    unread.map((it, i) =>
      '<div class="eq-row"><span class="i-name mag">' + esc(it.name) + '</span>' +
      '<button data-read="' + i + '">READ · ' + identifyCost(g) + ' gp</button></div>').join('');
  const known = cursed.length
    ? '<div class="tiny">Of the curses you carry: “not my trade any longer — take them up the lane, the vicar rings them loose.”</div>'
    : '';
  const box = townCard('sage-card', 'THE LECTOR',
    'A reader of runes who has outlived four of the things people brought in to be read.',
    purseLine(g) +
    '<div class="scrolly" style="max-height:280px">' +
      (rows || '<div class="tiny">Nothing you carry has anything left to tell.</div>') + '</div>' + known,
    'BACK TO THE STREET', npcPortrait('lector', 'male'));
  box.addEventListener('click', (e) => {
    const read = e.target.closest('[data-read]');
    if (read) { identifyItem(g, unread[Number(read.dataset.read)]); saveGame(); renderHud(g); if (currentTab === 'gear') renderGear(g); box.remove(); showSage(g); }
  });
  box.querySelector('[data-town-back]').onclick = () => {
    box.remove();
    /* From the walkable town you step back onto the green; the camp card
     * only exists where the town does not. */
    if (g.inTown && g.inTown()) { overlayHideAll(); canvasFocus(); } else showCamp(g);
  };
}

/* THE LITTLE TEMPLE: a bell, a basin, and the loosening of what the dark
 * ties on. The vicar works through every pack and back in the company —
 * the same law as the Lector's ledger. */
function showTemple(g) {
  const cursed = knownCurses(g);
  /* The bell answers two kinds of trouble: what is bound, and who is
   * beyond binding. A single companion falling used to have no answer at
   * all — the inn mends only the living. */
  const fallen = fallenMembers(g);
  const raises = fallen.map((m, i) =>
    '<div class="eq-row"><span class="i-name"><b>' + esc(m.name) + '</b> <span class="tiny">' +
    esc((CLASSES[m.cls] || {}).name || m.cls) + ' ' + m.level + ' · fallen</span></span>' +
    '<button data-raise="' + i + '"' + (g.purse() < raiseCost(m) ? ' disabled' : '') +
    '>RAISE · ' + raiseCost(m) + ' gp</button></div>').join('');
  const rows = cursed.map((it, i) =>
    '<div class="eq-row"><span class="i-name cursed">' + esc(it.name) + '</span>' +
    '<button data-unbind="' + i + '">UNBIND · ' + unbindCost(g) + ' gp</button></div>').join('');
  const box = townCard('temple-card', 'THE LITTLE TEMPLE',
    'Candle-smoke and old stone. The vicar reads nothing and asks nothing; she rings the bell, and what has hold of a thing lets go.',
    purseLine(g) +
    (raises ? '<h3 class="pane">THE FALLEN</h3><div class="scrolly" style="max-height:150px">' + raises + '</div>' : '') +
    '<h3 class="pane">WHAT IS BOUND</h3>' +
    '<div class="scrolly" style="max-height:200px">' +
      (rows || '<div class="tiny">Nothing the company carries is bound. The bell stays still.</div>') + '</div>',
    'BACK TO THE STREET', npcPortrait('vicar', 'female'));
  box.addEventListener('click', (e) => {
    const up = e.target.closest('[data-raise]');
    if (up) {
      raiseMember(g, fallen[Number(up.dataset.raise)]);
      saveGame(); renderHud(g); renderStats(g); renderGame(g);
      box.remove(); showTemple(g);
      return;
    }
    const un = e.target.closest('[data-unbind]');
    if (un) { unbindCurse(g, cursed[Number(un.dataset.unbind)]); saveGame(); renderHud(g); if (currentTab === 'gear') renderGear(g); box.remove(); showTemple(g); }
  });
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

/* Who you were before the stairs: every past trades something away, and
 * the card says exactly what. */
function bgLine(bg) {
  const adj = Object.entries(bg.statAdj || {})
    .map(([k, v]) => k.toUpperCase() + ' ' + (v > 0 ? '+' : '') + v).join(', ');
  const perk = bg.perks.skill ? '+1 ' + (skillById(bg.perks.skill) || {}).name
    : bg.perks.sight ? 'sees further'
    : bg.perks.goldMul ? 'finds more coin'
    : bg.perks.regen ? 'mends quicker'
    : bg.perks.undeadResist ? 'the unhallowed bite shallower'
    : '';
  return [adj, perk].filter(Boolean).join(' · ');
}

function paintBgPicker() {
  const box = document.getElementById('bg-picker');
  if (!box) return;
  box.innerHTML = '';
  for (const bg of BACKGROUNDS) {
    const el = document.createElement('div');
    el.className = 'class-opt' + (bg.id === selBackground ? ' sel' : '');
    const line = bgLine(bg);
    el.innerHTML = '<b>' + bg.name + '</b>' + (line ? ' <span class="tiny">' + line + '</span>' : '') +
      '<div class="d">' + bg.blurb + '</div>';
    el.onclick = () => { selBackground = bg.id; paintBgPicker(); };
    box.appendChild(el);
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
  paintBgPicker();
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
  g.foundAdventurer(name, selClass, eff, selBackground);
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

/* ---------------- the sprite bridge ----------------
 *
 * The Flare sheets drawn onto the old square grid, ahead of the isometric
 * renderer they were fetched for. Each sheet arrives lazily — image and
 * definition together — and until it does, or if it never does, the glyph
 * token underneath keeps the game playable. Bodies stand on tinted rings,
 * party colours and monster reds, which is where the colour coding lives
 * now that the sprites themselves cannot be tinted. */

const SPRITE_GRID = 32;    /* minicore's nominal tile, the scale sprites were made for */
const sheetCache = new Map();

function getSheet(kind, name, sex) {
  const key = kind + ':' + (sex ? sex + '/' : '') + name;
  if (sheetCache.has(key)) {
    const v = sheetCache.get(key);
    return v === 'pending' ? null : v;
  }
  sheetCache.set(key, 'pending');
  const imgUrl = kind === 'hero' ? heroLayerUrl(sex, name) : creatureSheetUrl(name);
  const defUrl = kind === 'hero' ? heroDefUrl(sex, name) : creatureDefUrl(name);
  Promise.all([
    loadImage(imgUrl),
    fetch(defUrl).then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ]).then(([img, text]) => {
    sheetCache.set(key, img && text ? { img, def: parseAnimationDef(text) } : null);
    lastTiles = '';   /* so the next paint notices the art arrived */
  });
  return null;
}

/* The floor atlases, cached the same way as the creature sheets. */
function getTileset(name) {
  const key = 'tileset:' + name;
  if (sheetCache.has(key)) {
    const v = sheetCache.get(key);
    return v === 'pending' ? null : v;
  }
  sheetCache.set(key, 'pending');
  Promise.all([
    loadImage(tilesetUrl(name)),
    fetch(tilesetDefUrl(name)).then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ]).then(([img, text]) => {
    sheetCache.set(key, img && text ? { name, img, def: parseTilesetDef(text) } : null);
    lastTiles = '';
  });
  return null;
}

/* AN ATLAS'S OWN SCALE. Flare's tilesets are drawn for a 192px diamond;
 * ours is 64. Floors get away with it — a ground piece painting three
 * tiles' worth of turf just bleeds over its neighbours, which is how the
 * texture reads continuous — but a PROP drawn at native size is a
 * three-times-lifesize anvil beside a correctly-sized house. Derived from
 * the atlas's own first tile rather than hardcoded, so a set authored at
 * another scale (the medieval kit, at 64) needs no special case. */
const atlasScaleCache = new Map();
function atlasScale(tset) {
  if (!tset || !tset.def) return 1;
  if (atlasScaleCache.has(tset.name)) return atlasScaleCache.get(tset.name);
  const first = Object.values(tset.def.tiles).find((r) => r && r.w > 0);
  const s = first ? ISO.TW / first.w : 1;
  atlasScaleCache.set(tset.name, s);
  return s;
}

/* THE BLACK IS NOT ROCK, SO IT SHOULD NOT BE PAINT.
 *
 * Flare's cliff and cavern pieces carry a large near-black margin — the
 * face that, in a continuous Flare cliff, the NEXT piece covers. This
 * renderer sets one piece per tile, so that margin stays visible and the
 * caverns read as slabs of void with a stripe of rock. The margin is
 * keyed OUT: near-black opaque pixels made transparent, hard below a
 * threshold and feathered above it so a crevice the artist meant as depth
 * does not become a hole.
 *
 * PER PIECE, not per atlas. The first version keyed the whole sheet —
 * 3072x5760 is seventeen million pixels, some seventy megabytes of canvas
 * per set, and because the context was opened `willReadFrequently` every
 * later drawImage came off a CPU-backed surface instead of the GPU. Three
 * atlases in and the whole scene crawled, worse the longer you played and
 * the more sets you had walked through. A wall vocabulary uses a handful
 * of pieces; keying just those costs well under a megabyte and draws at
 * full speed. */
const keyedPieces = new Map();
function getKeyedPiece(tset, id) {
  const key = tset.name + ':' + id;
  if (keyedPieces.has(key)) return keyedPieces.get(key);
  const r = tset.def.tiles[id];
  if (!r) { keyedPieces.set(key, null); return null; }
  /* Read on a scratch surface, then hand the result to a clean canvas the
   * compositor is happy to keep on the GPU. */
  const scratch = document.createElement('canvas');
  scratch.width = r.w; scratch.height = r.h;
  const sx = scratch.getContext('2d', { willReadFrequently: true });
  sx.drawImage(tset.img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  const px = sx.getImageData(0, 0, r.w, r.h);
  const d = px.data;
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const sum = d[i] + d[i + 1] + d[i + 2];
    if (sum < 42) { d[i + 3] = 0; continue; }
    if (sum < 96) d[i + 3] = Math.round(d[i + 3] * ((sum - 42) / 54));
    rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; n++;
  }
  sx.putImageData(px, 0, 0);
  const out = document.createElement('canvas');
  out.width = r.w; out.height = r.h;
  out.getContext('2d').drawImage(scratch, 0, 0);
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const made = { img: out, w: r.w, h: r.h, ox: r.ox, oy: r.oy,
    avg: n ? '#' + hex(rs / n) + hex(gs / n) + hex(bs / n) : null };
  keyedPieces.set(key, made);
  return made;
}

/* The colour a faceless wall mass wears: the average of the stone this
 * set's own wall pieces are painted in, taken from the keyed pieces that
 * are already built. Cached per set, since it never changes. */
const rockTones = new Map();
function rockToneOf(tset) {
  if (!tset || !WALL_VOCAB[tset.name]) return null;
  if (rockTones.has(tset.name)) return rockTones.get(tset.name);
  const v = WALL_VOCAB[tset.name];
  const ids = [...(v.x || []), ...(v.y || []), ...(v.corner || []), ...(v.inner || [])];
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (const id of ids) {
    const kp = getKeyedPiece(tset, id);
    if (!kp || !kp.avg) continue;
    const h = kp.avg;
    rs += parseInt(h.slice(1, 3), 16);
    gs += parseInt(h.slice(3, 5), 16);
    bs += parseInt(h.slice(5, 7), 16);
    n++;
  }
  const hex = (x) => Math.round(x).toString(16).padStart(2, '0');
  const tone = n ? '#' + hex(rs / n) + hex(gs / n) + hex(bs / n) : null;
  rockTones.set(tset.name, tone);
  return tone;
}

/* Which atlas dresses which theme: the masonry sets for built places, the
 * rough stone for grown ones. */
const THEME_TILESET = {
  temple: 'tileset_dungeon', tomb: 'tileset_dungeon', halls: 'tileset_dungeon',
  abyss: 'tileset_dungeon', arcane: 'tileset_dungeon',
  sewers: 'tileset_cave', cavern: 'tileset_cave', crystal: 'tileset_cave',
  fire: 'tileset_cave', ice: 'tileset_cave', jungle: 'tileset_cave',
};

/* Flare's floors: ids 16-19 are the plain stones, the higher ids the worn
 * and decorated ones. The hash is position, so a floor keeps its face. */
function floorPieceId(def, x, y) {
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  let id = 16 + (h % 4);
  if (h % 19 === 0) {
    const decor = 36 + ((h >> 4) % 11);
    if (def.tiles[decor]) id = decor;
  }
  return def.tiles[id] ? id : 16;
}

/* Kenney's furniture: single images, no definitions — a piece is a
 * picture with its feet at the bottom. Cached like everything else. */
function getProp(piece) {
  const key = 'prop:' + piece;
  if (sheetCache.has(key)) {
    const v = sheetCache.get(key);
    return v === 'pending' ? null : v;
  }
  sheetCache.set(key, 'pending');
  loadImage('assets/props/kenney/' + piece + '.png').then((img) => {
    sheetCache.set(key, img || null);
    lastTiles = '';
  });
  return null;
}

/* Flare's compass: eight directions counted clockwise from west. If the art
 * ever disagrees with this table, this is the one line to argue with. */
function flareDir(dx, dy) {
  if (!dx && !dy) return 6;   /* facing the viewer */
  return Math.round((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8;
}

function pickFrame(def, animName, dir, hold) {
  const anim = def.animations[animName] || def.animations.stance;
  if (!anim) return null;
  const frames = anim.frames[dir] || anim.frames[6] || anim.frames[0];
  if (!frames || !frames.length) return null;
  const n = frames.length;
  if (hold) return frames[n - 1];
  const dur = Math.max(100, anim.duration || 1000);
  let i = Math.floor(((performance.now() % dur) / dur) * n);
  if (anim.type === 'back_forth' && n > 1) {
    const cycle = 2 * n - 2;
    i = Math.floor(((performance.now() % (dur * 2)) / (dur * 2)) * cycle);
    if (i >= n) i = cycle - i;
  }
  return frames[Math.max(0, Math.min(n - 1, i))];
}

/* The tallest stance frame is what a creature's size means: the number the
 * artist actually drew, from the 12px antlion to the 114px wyrm. */
function stanceHeight(def) {
  let h = 0;
  const st = def.animations.stance || Object.values(def.animations)[0];
  if (st) for (const dir of st.frames) for (const f of dir || []) if (f && f.h > h) h = f.h;
  return h || SPRITE_GRID;
}

/* Draws one sheet's current frame with its feet on the tile. The frame's
 * offsets are relative to the entity's anchor, which is what keeps a hero's
 * six layers of gear standing inside each other rather than beside.
 *
 * Two scales: hero layers share one fixed scale, because they must agree
 * with each other; creatures are scaled from their own stance height along
 * a compressed curve, so a rat is small without being invisible and a wyrm
 * is enormous without being the whole room.
 *
 * Both read that curve in the art's own pixels, and the art no longer agrees
 * with itself about how big a pixel is: a repacked sheet carries six times
 * the detail in the same creature. So the height is divided back down to the
 * scale the curve was tuned against before it is asked how big a thing is,
 * and multiplied back up when the drawing happens. Sheets that were never
 * repacked declare a scale of one and pass through untouched. */
function drawFrameAt(ax, ay, unit, entry, animName, dir, opts = {}) {
  const f = pickFrame(entry.def, animName, dir, opts.hold);
  if (!f) return false;
  const ctx = els.ctx;
  const src = entry.def.scale || 1;
  let scale;
  if (opts.fit) {
    if (!entry.baseH) entry.baseH = stanceHeight(entry.def);
    const nominal = entry.baseH / src;
    const targetH = unit * Math.min(1.9, Math.max(0.7, 0.5 + 0.55 * nominal / 40));
    scale = (targetH / entry.baseH) * (opts.scale || 1);
  } else {
    scale = (unit / (28 * src)) * (opts.scale || 1);
  }
  if (opts.dim) ctx.globalAlpha = 0.55;
  ctx.drawImage(entry.img, f.x, f.y, f.w, f.h,
    ax - f.ox * scale, ay - f.oy * scale, f.w * scale, f.h * scale);
  ctx.globalAlpha = 1;
  return true;
}

function drawFrame(x, y, entry, animName, dir, opts = {}) {
  if (x < camX || y < camY || x >= camX + viewW || y >= camY + viewH) return false;
  const s = ts;
  return drawFrameAt((x - camX) * s + s / 2, (y - camY) * s + s * 0.85, s, entry, animName, dir, opts);
}

function drawRingAt(ax, ay, rx, ry, color, opts = {}) {
  const ctx = els.ctx;
  ctx.beginPath();
  ctx.ellipse(ax, ay, rx, ry, 0, 0, Math.PI * 2);
  if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.bold ? 2 : 1;
  ctx.globalAlpha = opts.dim ? 0.5 : 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

function drawRing(x, y, color, opts = {}) {
  if (x < camX || y < camY || x >= camX + viewW || y >= camY + viewH) return;
  const s = ts;
  drawRingAt((x - camX) * s + s / 2, (y - camY) * s + s * 0.82, s * 0.38, s * 0.17, color, opts);
}

/* Nothing on a member says man or woman, so the name decides, stably. */
function heroSex(m) {
  let h = 0;
  for (const c of String(m.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 ? 'female' : 'male';
}

/* A member as a paper doll: bare body, then head, then everything worn over
 * it, in the order the lists in sprites.js were written. The fallen lie on
 * the last frame of their dying. Returns false if not one layer was ready,
 * so the caller can fall back to the glyph its renderer knows how to draw. */
function drawMemberAt(ax, ay, unit, rx, ry, m, tint, acting) {
  const sex = heroSex(m);
  const dead = m.hp <= 0;
  /* Facing where they last meant to go; a body with no history faces the
   * camera, because flareDir answers 6 for a zero delta. */
  const dir = flareDir(m.faceDx || 0, m.faceDy || 0);
  drawRingAt(ax, ay, rx, ry, dead ? '#7a3a30' : tint, {
    bold: acting,
    fill: acting ? 'rgba(255,255,255,0.10)' : undefined,
    dim: !acting && !dead,
  });
  const base = HERO_LAYERS[m.cls] || [];
  const layers = [...base.slice(0, 2), HERO_HEADS[sex], ...base.slice(2)];
  let drew = false;
  for (const layer of layers) {
    const entry = getSheet('hero', layer, sex);
    if (entry && drawFrameAt(ax, ay, unit, entry, dead ? 'die' : 'stance', dir, { dim: dead, hold: dead })) drew = true;
  }
  return drew;
}

function drawMember(m, tint, acting) {
  const s = ts;
  const ax = (m.x - camX) * s + s / 2, ay = (m.y - camY) * s + s * 0.85;
  const drew = drawMemberAt(ax, ay - s * 0.03, s, s * 0.38, s * 0.17, m, tint, acting);
  if (!drew) drawGlyph(m.x, m.y, PLAYER_GLYPH, m.hp <= 0 ? '#7a3a30' : tint, !acting && m.hp > 0, acting);
}

/* ---------------- the mouse ----------------
 *
 * Click a tile the party has seen and they walk there; click a monster and
 * they walk to it and strike; click a townsfolk and they walk over and talk;
 * click your own feet and you loot them. Hovering previews the route as a
 * line of dots and names what the cursor rests on. The keyboard loses
 * nothing — any keypress cancels the walk and takes over.
 *
 * Out of combat a click walks the whole route, one round per step, on a
 * short leash: the walk stops the moment combat starts, anyone loses blood,
 * a card comes up, or the floor changes underfoot. In combat a click is one
 * action — one step, or one swing — because walking across a fight on
 * autopilot is how autopilots die. */

let hoverTile = null;   /* {x, y} under the cursor, in floor coordinates */
let hoverPath = null;   /* the previewed route to it, or null */
let walkDest = null;    /* where the click is taking the company */
let walkPath = null;    /* the route being walked — recomputed every tick, kept for the dots */
let walkTimer = null;
let walkLastLen = Infinity;   /* the stall breaker: a walk that stops shrinking is going nowhere */
let walkStall = 0;

function cancelWalk() {
  walkPath = null;
  walkDest = null;
  walkLastLen = Infinity;
  walkStall = 0;
  if (walkTimer) { clearTimeout(walkTimer); walkTimer = null; }
}

function tileFromEvent(e) {
  if (!game || !game.currentFloor) return null;
  /* Mouse coordinates arrive in screen pixels, and the page is drawn under
   * `html { zoom }` — so measure the canvas as the mouse sees it and scale
   * back to bitmap pixels. Robust against any zoom or stretching. */
  const rect = els.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ox = (e.clientX - rect.left) * (els.canvas.width / rect.width) / pixelScale;
  const oy = (e.clientY - rect.top) * (els.canvas.height / rect.height) / pixelScale;
  let x, y;
  if (viewMode === 'iso') {
    ({ x, y } = screenToIso(ox / isoZoom + isoCamX, oy / isoZoom + isoCamY));
  } else {
    x = camX + Math.floor(ox / ts);
    y = camY + Math.floor(oy / ts);
    if (x < camX || y < camY || x >= camX + viewW || y >= camY + viewH) return null;
  }
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  return { x, y };
}

/* What stands where the click landed — only what the player could name too:
 * visible monsters (or revealed ones), visible townsfolk, remembered tiles. */
function monsterAtTile(g, x, y) {
  return (g.currentFloor.monsters || []).find((m) =>
    m.hp > 0 && m.x === x && m.y === y &&
    ((inView(x, y) && !m.submerged) || m.revealed));
}
function npcAtTile(g, x, y) {
  return (g.currentFloor.npcs || []).find((n) => n.x === x && n.y === y && inView(x, y));
}

/* Everything that blocks a route: living monsters the player knows about and
 * townsfolk. Party members are left out — walking into one trades places. */
function routeBlockers(g) {
  const blocked = new Set();
  for (const m of g.currentFloor.monsters || []) {
    if (m.hp > 0 && !m.submerged) blocked.add(m.x + ',' + m.y);
  }
  for (const n of g.currentFloor.npcs || []) blocked.add(n.x + ',' + n.y);
  return blocked;
}

function routeTo(g, x, y, avoid) {
  const p = g.state.player;
  /* Stairs are destinations, not waypoints: the route walks around them
   * unless the click points AT one — a party crossing a staircase on the
   * way to somewhere else was whisked down a floor mid-walk. */
  const soft = new Set();
  const f = g.currentFloor;
  for (let ty = 0; ty < f.h; ty++) {
    for (let tx = 0; tx < f.w; tx++) {
      const t = f.tiles[ty][tx];
      if (t === T.UP || t === T.DOWN) soft.add(tx + ',' + ty);
    }
  }
  /* Callers may add their own reluctances — companions, when the point of
   * the walk is to get somewhere WITHOUT shouldering anyone aside. */
  for (const k of avoid || []) soft.add(k);
  return findPath({
    tiles: f.tiles,
    seen: g.seen,
    from: { x: p.x, y: p.y },
    to: { x, y },
    blocked: routeBlockers(g),
    soft,
  });
}

/* Where this member could stand and still swing at the target: the ring
 * around it, minus anything already occupied, minus what cannot be walked
 * on. Sorted by how far the walk is, so the nearest honest opening wins. */
function attackStations(g, mo) {
  const f = g.currentFloor;
  const me = g.state.player;
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = mo.x + dx, y = mo.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (!g.seen[y] || !g.seen[y][x]) continue;
      if (!isTravelable(f.tiles[y][x]) && f.tiles[y][x] !== T.DOOR_C) continue;
      if (g.memberAt(x, y) && !(x === me.x && y === me.y)) continue;
      if ((f.monsters || []).some((m2) => m2.hp > 0 && m2.x === x && m2.y === y)) continue;
      if ((f.npcs || []).some((n) => n.x === x && n.y === y)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/* One step of the route: the same keypress the keyboard would have made,
 * with the same bookkeeping after it. */
function takeStep(step, next) {
  const g = game, p = g.state.player;
  const dx = step.x - p.x, dy = step.y - p.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)) return false;
  /* Where the route CONTINUES after this tile — so a slip past a companion
   * ejects along the route instead of blindly straight through. */
  const flags = { dx, dy };
  if (next) { flags.exitDx = next.x - step.x; flags.exitDy = next.y - step.y; }
  const acted = g.handleKey(null, flags);
  /* A step can pick something up on landing, so the pack repaints too. */
  renderGear(g);
  saveGame();
  return acted;
}

function walkTick() {
  walkTimer = null;
  const g = game;
  if (!walkDest || !g || g.dying) { cancelWalk(); return; }
  if (!els.overlay.classList.contains('hidden')) { cancelWalk(); return; }
  const p = g.state.player;
  if (p.x === walkDest.x && p.y === walkDest.y) { cancelWalk(); return; }
  /* Re-routed from WHERE YOU NOW STAND, every tick. A queue of steps laid
   * at click time went stale the moment a step slipped past a companion
   * (two tiles covered, not one) or the van re-took its station in front
   * of the leader — and a stale queue cancelled the walk on its second
   * step. The destination is the promise; the route is disposable. */
  walkPath = routeTo(g, walkDest.x, walkDest.y);
  if (!walkPath || !walkPath.length) { cancelWalk(); return; }
  /* Clicking a friend is not an order to trample them: when the destination
   * is a companion on plain ground, arriving beside them is arriving. */
  const destAlly = g.livingMembers().find((m) => m !== p && m.x === walkDest.x && m.y === walkDest.y);
  if (destAlly && Math.max(Math.abs(p.x - walkDest.x), Math.abs(p.y - walkDest.y)) <= 1) {
    const dt = g.currentFloor.tiles[walkDest.y][walkDest.x];
    const special = dt === T.UP || dt === T.DOWN || dt === T.ALTAR ||
      (g.currentFloor.items || []).some((it) => it.x === walkDest.x && it.y === walkDest.y);
    if (!special) { cancelWalk(); return; }
  }
  /* The stall breaker: three ticks without the route getting shorter means
   * the walk is fighting the world — a shuffle, a shove, a slip that gave
   * the ground back. Stop rather than shake the screen. */
  if (walkPath.length >= walkLastLen) {
    if (++walkStall >= 3) { cancelWalk(); return; }
  } else {
    walkStall = 0;
  }
  walkLastLen = walkPath.length;
  const floorBefore = p.floorIdx + ':' + p.dungeonId;
  const bloodBefore = g.livingMembers().reduce((s, m) => s + m.hp, 0);
  if (!takeStep(walkPath[0], walkPath[1])) { cancelWalk(); return; }
  walkPath.shift();
  const stillCalm = g.outOfCombat();
  const bloodAfter = g.livingMembers().reduce((s, m) => s + m.hp, 0);
  if ((p.x === walkDest.x && p.y === walkDest.y) || !stillCalm || bloodAfter < bloodBefore ||
      floorBefore !== p.floorIdx + ':' + p.dungeonId ||
      !els.overlay.classList.contains('hidden')) {
    cancelWalk();
    return;
  }
  walkTimer = setTimeout(walkTick, 110);
}

function onCanvasClick(e) {
  const g = game;
  canvasFocus();
  if (!g || g.dying || !g.currentFloor) return;
  if (!els.overlay.classList.contains('hidden') || dialogueOpen) return;
  cancelWalk();
  const t = tileFromEvent(e);
  if (!t) return;
  const p = g.state.player;
  if (t.x === p.x && t.y === p.y) {
    /* your own feet: loot them (into the focused character's pack), or
     * hear what is here. Repaint the pack: this was the ONE loot path
     * that left an open gear tab stale, and a Battle Axe "vanished" into
     * an inventory the screen refused to re-read. */
    g.handleKey('g', { lootTo: viewedIdx === null ? undefined : viewedIdx });
    if (currentTab === 'gear') renderGear(g);
    renderStats(g);
    saveGame();
    return;
  }
  if (!(g.seen && g.seen[t.y] && g.seen[t.y][t.x])) return;   /* the dark is not clickable */
  const path = routeTo(g, t.x, t.y);
  if (!path || !path.length) { g.log('No way there that you have seen.'); return; }
  if (g.outOfCombat()) {
    walkDest = { x: t.x, y: t.y };
    walkTick();
  } else {
    /* In combat one click is one TURN'S worth: walk toward the tile while
     * this member's ground lasts, re-routing after every step — a step can
     * slip past a companion and cover two tiles, and a queue laid at click
     * time goes stale. If the next step is something hostile, the blow
     * lands too, ground or none — ToEE's move-and-strike on one click.
     * Openings given along the way are given; the preview showed them red. */
    const me = p;
    const turn0 = g.turn;   /* one click never spends a second round */
    /* CLICKING A MONSTER ASKS FOR A FIGHT, NOT A SHOVING MATCH. If a
     * companion already holds the square in front of it, go round: any
     * free tile touching the target will do, and the walk avoids the
     * company while a way round exists. Only when nothing beside the
     * target is both free and reachable does anyone get displaced —
     * which is the difference between "take the flank" and "get out of
     * my way". */
    const target = monsterAtTile(g, t.x, t.y);
    let dest = { x: t.x, y: t.y };
    let avoid = null;
    if (target) {
      const allies = g.livingMembers().filter((m) => m !== me);
      avoid = new Set(allies.map((m) => m.x + ',' + m.y));
      if (Math.max(Math.abs(me.x - target.x), Math.abs(me.y - target.y)) > 1) {
        let best = null;
        for (const s of attackStations(g, target)) {
          const r = routeTo(g, s.x, s.y, avoid);
          if (!r) continue;
          /* A station a companion is standing on is no station at all; a
           * route that has to walk through one is a last resort. */
          const throughAlly = r.some((st) => avoid.has(st.x + ',' + st.y));
          const cost = r.length + (throughAlly ? 100 : 0);
          if (!best || cost < best.cost) best = { cost, x: s.x, y: s.y };
        }
        if (best) dest = { x: best.x, y: best.y };
      }
    }
    let guard = 32;
    while (guard-- > 0) {
      if (g.dying || g.state.player !== me || g.outOfCombat() || g.turn !== turn0) break;
      if (me.x === dest.x && me.y === dest.y) break;
      const route = routeTo(g, dest.x, dest.y, avoid);
      if (!route || !route.length) break;
      const step = route[0];
      const hostile = monsterAtTile(g, step.x, step.y);
      if (!hostile && (g.actorTurn(me).moved || 0) >= g.memberSpeed(me)) break;
      if (!takeStep(step, route[1])) break;
      if (hostile) break;
    }
    /* Arrived beside it with the blow still owed: strike. */
    if (target && target.hp > 0 && g.state.player === me && g.turn === turn0 &&
        Math.max(Math.abs(me.x - target.x), Math.abs(me.y - target.y)) === 1) {
      g.handleKey(null, { dx: Math.sign(target.x - me.x), dy: Math.sign(target.y - me.y) });
      saveGame();
    }
  }
}

function onCanvasMove(e) {
  const t = tileFromEvent(e);
  const changed = !t !== !hoverTile || (t && hoverTile && (t.x !== hoverTile.x || t.y !== hoverTile.y));
  if (!changed) return;
  hoverTile = t;
  hoverPath = null;
  if (game && t && game.seen && game.seen[t.y] && game.seen[t.y][t.x] && !game.dying) {
    const p = game.state.player;
    if (t.x !== p.x || t.y !== p.y) hoverPath = routeTo(game, t.x, t.y);
    els.canvas.style.cursor = (hoverPath && hoverPath.length) || (t.x === p.x && t.y === p.y) ? 'pointer' : 'default';
  } else {
    els.canvas.style.cursor = 'default';
  }
  lastTiles = '';
}

function onCanvasLeave() {
  hoverTile = null;
  hoverPath = null;
  els.canvas.style.cursor = 'default';
  lastTiles = '';
}

/* THE INITIATIVE BAR: the round, made visible. Party chips in their tints,
 * everything hostile in red, the chip whose turn it is burning brighter,
 * and the turn readout beside them — because with a company on the board,
 * "whose turn is it and how far can they still go" belongs on the screen. */
function renderInitiative(g) {
  const bar = els.iniBar;
  if (!bar) return;
  const r = g._round;
  if (!g.currentFloor || !r || g.outOfCombat() || g.dying) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const p = g.state.player;
  const at = g.actorTurn(p);
  const out = [];
  r.order.forEach((e, i) => {
    if (!e.ref || e.ref.hp <= 0) return;
    const now = e.member && e.ref === p && !at.acted;
    const done = i < r.idx && !now;
    if (e.member) {
      const idx = g.state.party.members.indexOf(e.ref);
      out.push('<span class="ini-chip' + (now ? ' now' : done ? ' done' : '') +
        '" style="color:' + tintOf(e.ref, idx) + ';border-color:' + tintOf(e.ref, idx) + '">' +
        esc(e.ref.name) + '</span>');
    } else {
      out.push('<span class="ini-chip hostile' + (done ? ' done' : '') + '">' +
        esc(e.ref.t.name) + '</span>');
    }
  });
  /* GROUND LEFT, not ground spent. It counted upward from zero, so a turn
   * opened reading "moves 0/5" — which says "no moves" to every eye that
   * has ever read a health bar, at the exact moment the character has all
   * five. Count down, like everything else that can run out. */
  const speed = g.memberSpeed(p);
  const left = Math.max(0, speed - (at.moved || 0));
  out.push('<span class="ini-turn">moves ' + left + '/' + speed +
    ' · strike or SPACE ends</span>');
  bar.innerHTML = out.join('');
}

/* Would this step draw blood on the way out? Leaving a square a woken
 * monster threatens provokes — except the turn's single free shift. The
 * preview paints those steps red, which is the threat display ToEE put on
 * the battle map: you see the cost before you spend it. */
function leavesThreat(g, fromX, fromY) {
  return (g.currentFloor.monsters || []).some((m) =>
    m.hp > 0 && m.aggro && !(m.stunned > 0) && !m.submerged &&
    Math.max(Math.abs(m.x - fromX), Math.abs(m.y - fromY)) <= 1);
}

/* The colour of each previewed step: red where the route would draw blood
 * on the way out. A route of one single step is the free shift and stays
 * calm; any longer and every threatened departure shows its price. */
function routeDotStyles(g, path) {
  if (!path || g.outOfCombat()) return null;
  const p = g.state.player;
  const moved = g.actorTurn(p).moved || 0;
  if (moved + path.length <= 1) return null;   /* the shift */
  const styles = [];
  let fx = p.x, fy = p.y;
  for (const st of path) {
    styles.push(leavesThreat(g, fx, fy));
    fx = st.x; fy = st.y;
  }
  return styles;
}

/* What the cursor rests on, named. Only what the party could name too. */
function hoverLabel(g, x, y) {
  const m = monsterAtTile(g, x, y);
  if (m) {
    const hurt = m.hp >= m.t.hpMax ? '' : m.hp > m.t.hpMax / 2 ? ', wounded' : ', badly hurt';
    return (m.boss ? '☠ ' : '') + m.t.name + hurt;
  }
  const n = npcAtTile(g, x, y);
  if (n) return (n.tpl && n.tpl.name) || 'Someone';
  if (inView(x, y)) {
    const here = (g.currentFloor.items || []).filter((it) => it.x === x && it.y === y);
    if (here.length) return here.map((it) => (it.i && it.i.name) || 'something').join(', ');
  }
  const t = g.currentFloor.tiles[y][x];
  if (t === T.DOWN) {
    const mouth = (g.currentFloor.mouths || []).find((mm) => mm.x === x && mm.y === y);
    if (mouth) return 'Down: ' + mouth.name;
    return 'Stairs down';
  }
  if (t === T.UP) return 'Stairs up';
  if (t === T.ALTAR) return 'An altar';
  if (t === T.WATER) return 'Black water';
  if (t === T.DOOR_C) return 'A closed door';
  return '';
}

function drawMouseOverlay(g) {
  const ctx = els.ctx, s = ts;
  if (hoverPath && hoverPath.length && !walkPath) {
    const styles = routeDotStyles(g, hoverPath);
    for (let i = 0; i < hoverPath.length - 1; i++) {
      const st = hoverPath[i];
      ctx.fillStyle = styles && styles[i] ? 'rgba(224, 96, 80, 0.8)' : 'rgba(230, 220, 160, 0.5)';
      ctx.beginPath();
      ctx.arc((st.x - camX) * s + s / 2, (st.y - camY) * s + s / 2, Math.max(1.5, s * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (walkPath && walkPath.length) {
    ctx.fillStyle = 'rgba(230, 220, 160, 0.35)';
    for (const st of walkPath) {
      ctx.beginPath();
      ctx.arc((st.x - camX) * s + s / 2, (st.y - camY) * s + s / 2, Math.max(1.5, s * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!hoverTile) return;
  const { x, y } = hoverTile;
  if (x < camX || y < camY || x >= camX + viewW || y >= camY + viewH) return;
  if (!(g.seen && g.seen[y] && g.seen[y][x])) return;
  const px = (x - camX) * s, py = (y - camY) * s;
  const hostile = monsterAtTile(g, x, y);
  ctx.strokeStyle = hostile ? 'rgba(224, 96, 80, 0.9)' : 'rgba(230, 220, 160, 0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  const label = hoverLabel(g, x, y);
  if (label) {
    ctx.font = Math.max(10, Math.round(s * 0.55)) + 'px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const wLabel = ctx.measureText(label).width + 8;
    const lh = Math.max(14, Math.round(s * 0.8));
    let lx = px + s + 3, ly = py - lh / 2 - 1;
    if (lx + wLabel > viewW * s) lx = px - wLabel - 3;
    if (ly < 0) ly = py + s + 1;
    ctx.fillStyle = 'rgba(5, 7, 5, 0.85)';
    ctx.fillRect(lx, ly, wLabel, lh);
    ctx.strokeStyle = 'rgba(230, 220, 160, 0.4)';
    ctx.strokeRect(lx + 0.5, ly + 0.5, wLabel - 1, lh - 1);
    ctx.fillStyle = hostile ? '#e0aa60' : '#cfe0c0';
    ctx.fillText(label, lx + 4, ly + lh / 2 + 1);
    ctx.textAlign = 'center';   /* the renderer's standing alignment */
  }
}

/* ---------------- canvas renderer ---------------- */
let ts = 20;
let viewW = W, viewH = H;   /* size of the visible window, in tiles */
let camX = 0, camY = 0;     /* top-left tile of that window */
let lastTiles = '';

/* How much floor to try to show before tiles are allowed to shrink further. */
const TARGET_COLS = 42;
const TARGET_ROWS = 27;

/* How many device pixels stand behind one CSS pixel of the canvas: the
 * page's own zoom times the display's density. The bitmap is allocated at
 * this scale and every renderer draws through it as a base transform, so
 * the artwork reaches the glass at true resolution instead of being
 * painted small and stretched blurry — which is what "the game looks very
 * low resolution" was. */
let pixelScale = 1;

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
  const zRaw = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const zoomF = zRaw > 10 ? zRaw / 100 : zRaw;   /* some engines answer in percent */
  pixelScale = (window.devicePixelRatio || 1) * zoomF;
  const cssW = viewW * ts, cssH = viewH * ts;
  els.canvas.width = Math.round(cssW * pixelScale);
  els.canvas.height = Math.round(cssH * pixelScale);
  els.canvas.style.width = cssW + 'px';
  els.canvas.style.height = cssH + 'px';
  els.ctx.imageSmoothingQuality = 'high';   /* reset with the bitmap, so re-set with it */
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
  const floor = g.currentFloor;
  if (!floor) return;
  const p = g.state.player;
  const sa = Math.floor(performance.now() / 700) % 2;
  /* The animation bucket: stances breathe at five frames a second, which is
   * as alive as a 200ms repaint interval can make them. */
  const ab = Math.floor(performance.now() / 200);
  const key = viewMode + ':' + isoZoom + ':' + wallMode + ':' + p.dungeonId + ':' + p.floorIdx + ':' + p.x + ',' + p.y +
    ':' + g.turn + ':' + sa + ':' + ab +
    ':' + (hoverTile ? hoverTile.x + ',' + hoverTile.y : '-') +
    ':' + (walkPath ? walkPath.length : 0);
  if (key === lastTiles && els.canvas.width) return;
  lastTiles = key;
  if (viewMode === 'iso') renderIsoScene(g, sa);
  else renderClassic(g, sa);
}

function renderClassic(g, sa) {
  const ctx = els.ctx;
  const floor = g.currentFloor;
  const p = g.state.player;
  const s = ts;
  const theme = getTheme(g.inTown && g.inTown() ? 'town' : (g.dungeonById(p.dungeonId) || {}).theme);
  updateCamera(p);

  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
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
    const tint = cls(monsterTint(m.t.tier, m.boss));
    const dim = !inView(m.x, m.y) || m.submerged;
    const sheet = CREATURE_SHEETS[m.t.id];
    const entry = sheet ? getSheet('creature', sheet) : null;
    if (entry) {
      drawRing(m.x, m.y, tint, { dim, bold: !!m.boss });
      /* Facing whoever holds the reins — a stance, not an intent. */
      if (!drawFrame(m.x, m.y, entry, 'stance', flareDir(p.x - m.x, p.y - m.y), { dim, fit: true, scale: m.boss ? 1.3 : 1 })) {
        drawGlyph(m.x, m.y, m.t.glyph, tint, dim);
      }
    } else {
      drawGlyph(m.x, m.y, m.t.glyph, tint, dim);
    }
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
    /* Every member on the board; the one at the reins is bright and boxed,
     * companions a step dimmer, the fallen a dark ember where they dropped. */
    g.state.party.members.forEach((m, i) => {
      if (!m || m === p) return;
      if (m.floorIdx !== p.floorIdx || m.dungeonId !== p.dungeonId) return;
      drawMember(m, tintOf(m, i), false);
    });
    drawMember(p, tintOf(p, g.state.party.members.indexOf(p)), true);
  }
  drawMouseOverlay(g);
}

/* ---------------- the isometric scene ----------------
 *
 * The same floor, stood up at Flare's angle: painterly ground pieces from
 * the tileset atlases, walls as shaded prisms until the wall art is
 * curated, and every body drawn by the same paper-doll and creature code
 * as the classic view, at pixel anchors the projection hands out. The
 * classic top-down grid stays one V away — it is the tactical map now,
 * not the whole game. */

/* WHICH WORKINGS ARE SHOWING THEIR REACH. A set of ability ids, remembered
 * across sessions, because a player who wants to see where Firebolt stops
 * wants to see it tomorrow as well. Ticked one at a time so a Mage can
 * compare two spells' reach at once without reading numbers. */
let rangeRings = new Set();
try { rangeRings = new Set(JSON.parse(localStorage.getItem('lapsai-rings') || '[]')); } catch { /* private mode */ }
function saveRings() {
  try { localStorage.setItem('lapsai-rings', JSON.stringify([...rangeRings])); } catch { /* private mode */ }
}

/* A stable colour per working, so a ring you learned to recognise keeps its
 * colour, and two rings on the ground at once can be told apart. Chosen to
 * sit on grass, rock and dark floor alike without reading as a monster tint
 * (nothing here is red — red on this map always means something alive). */
const RING_COLOURS = ['#e8b44a', '#5fd0e8', '#84dd7a', '#c98ae8', '#e8a06a'];
function ringColour(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RING_COLOURS[h % RING_COLOURS.length];
}

let viewMode = 'iso';
try { viewMode = localStorage.getItem('lapsai-view') || 'iso'; } catch { /* private mode */ }
let isoCamX = 0, isoCamY = 0;

/* The unexplored is UNKNOWN, not void: pure black beside carved stone
 * read as holes in the world (the playtest's walls-up complaint, at
 * root). A faint woven hatch makes the same darkness read as map-edge —
 * territory the torch has not reached — while staying dark enough that
 * everything lit sits above it. Built once, tiled by the canvas. */
let unknownPattern = null;
function getUnknownPattern(ctx) {
  if (unknownPattern) return unknownPattern;
  const pc = document.createElement('canvas');
  pc.width = 24; pc.height = 24;
  const c = pc.getContext('2d');
  c.fillStyle = '#070907';
  c.fillRect(0, 0, 24, 24);
  c.strokeStyle = 'rgba(120, 130, 100, 0.05)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-6, 30); c.lineTo(30, -6);
  c.moveTo(6, 30); c.lineTo(30, 6);
  c.moveTo(-6, 18); c.lineTo(18, -6);
  c.stroke();
  unknownPattern = ctx.createPattern(pc, 'repeat');
  return unknownPattern;
}
let isoZoom = 1;
/* THE CEILING IS THE ART'S OWN SIZE. Flare draws for a 192-pixel diamond
 * and this grid is 64, so every wall, floor and prop carries three times
 * the detail the default view asks of it — leaning all the way in to 3x
 * is drawing the art at exactly the size it was painted, not upscaling a
 * smaller picture. Which is the zoom a fight wants: bodies large enough
 * to read a stance at, and the same crispness the wide view has. */
const ZOOM_MIN = 0.4, ZOOM_MAX = 3;
try { isoZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(localStorage.getItem('lapsai-zoom')) || 1)); } catch { /* private mode */ }

/* Whether walls stand at their carved height ('up') or kneel to stubs
 * everywhere ('down') — ToEE's wall button, asked for by name in the
 * playtest. Occlusion still cuts the near walls in 'up'; 'down' is the
 * pure battle map. */
let wallMode = 'up';
try { wallMode = localStorage.getItem('lapsai-walls') === 'down' ? 'down' : 'up'; } catch { /* private mode */ }

/* Straight back to a repaint per notch, because that is what was smooth.
 * Two attempts to "improve" this made it worse: coalescing to an
 * animation frame, then easing toward a target — the second rendered the
 * scene a dozen times per notch at intermediate scales and felt like mud.
 * A repaint measures under six milliseconds; it does not need help. Only
 * the preference write is deferred, since that touches disk. */
let zoomSave = null;
function setIsoZoom(z) {
  isoZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  lastTiles = '';
  if (game) renderGame(game);
  clearTimeout(zoomSave);
  zoomSave = setTimeout(() => {
    try { localStorage.setItem('lapsai-zoom', String(isoZoom)); } catch { /* private mode */ }
  }, 200);
}
const ISO_UNIT = 46;   /* what "one tile tall" means for a body in the scene */

function traceDiamond(ctx, sx, sy) {
  const pts = diamondPath(sx, sy);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function fillDiamond(ctx, sx, sy, style, alpha) {
  traceDiamond(ctx, sx, sy);
  if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* A wall as a prism: two faces down to the ground diamond's south corners
 * and a lid. The styles arrive ready-shaded, so dimming is the caller's. */
function drawPrism(ctx, sx, sy, h, topStyle, westStyle, eastStyle) {
  const hw = ISO.TW / 2, hh = ISO.TH / 2;
  ctx.fillStyle = eastStyle;
  ctx.beginPath();
  ctx.moveTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx, sy + hh - h);
  ctx.lineTo(sx + hw, sy - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = westStyle;
  ctx.beginPath();
  ctx.moveTo(sx - hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx, sy + hh - h);
  ctx.lineTo(sx - hw, sy - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = topStyle;
  traceDiamond(ctx, sx, sy - h);
  ctx.fill();
}

function drawIsoGlyph(x, y, ch, color, lift) {
  const { sx, sy } = isoToScreen(x, y);
  els.ctx.fillStyle = color;
  els.ctx.fillText(ch, sx - isoCamX, sy - isoCamY + (lift || 0));
}

/* GROUND ITEMS wear Flare's own icon art (assets/icons/icons.png, a 64px
 * grid, 8 icons per row) instead of a catalogue letter. The map is by item
 * id where the sheet has the exact thing — the potion row's colours happen
 * to match the catalogue's almost one for one — and by kind for anything
 * new. An id absent from both falls back to the letter, which is also the
 * safety net while the sheet is still loading. The Tarnished Crown keeps
 * its C: the sheet has no crown, and a wrong picture is worse than a
 * letter. */
const ITEM_ICONS = {
  dagger: 96, 'short-sword': 98, broadsword: 99, 'two-handed-sword': 100,
  mace: 111, staff: 104, 'hand-axe': 117, 'battle-axe': 119,
  'war-hammer': 102,
  /* No 107 for frost: that icon's starburst bleeds to the slab's edge, so
   * keyed onto the floor it stays a square block. The plain wand reads
   * better than the right wand read badly. */
  'wand-of-fire': 105, 'wand-of-healing': 106, 'wand-of-frost': 104,
  'padded-armor': 129, 'leather-armor': 137, 'studded-armor': 145,
  chainmail: 153, 'scale-armor': 145, plate: 161,
  'small-shield': 120, 'large-shield': 121, 'tower-shield': 123,
  'ring-protection': 202, 'ring-strength': 199, 'ring-regeneration': 205,
  'ring-arcana': 204,
  'amulet-ward': 214, 'amulet-seeing': 215, 'amulet-luck': 88,
  'potion-heal': 84, 'potion-major-heal': 85, 'potion-power': 81,
  'potion-strength': 82, 'potion-remove-curse': 83,
  'scroll-identify': 72, 'scroll-remove-curse': 73, 'scroll-teleport': 74,
  'scroll-recall': 75, 'scroll-reveal': 76, 'scroll-flame': 77,
  'scroll-sanctuary': 78,
  'gold-pile': 88, gem: 68, statuette: 216,
  'kind:weapon': 98, 'kind:wand': 104, 'kind:armor': 137,
  'kind:shield': 121, 'kind:ring': 199, 'kind:amulet': 214,
  'kind:potion': 84, 'kind:scroll': 72, 'kind:special': 88,
};

function itemIconIndex(i) {
  if (!i) return ITEM_ICONS['gold-pile'];   // bare gold drops
  const byId = ITEM_ICONS[i.id];
  if (byId !== undefined) return byId;
  const byKind = ITEM_ICONS['kind:' + i.kind];
  return byKind !== undefined ? byKind : null;
}

function getIconSheet() {
  const key = 'icons';
  if (sheetCache.has(key)) {
    const v = sheetCache.get(key);
    return v === 'pending' ? null : v;
  }
  sheetCache.set(key, 'pending');
  loadImage('assets/icons/icons.png').then((img) => {
    sheetCache.set(key, img || null);
    lastTiles = '';
  });
  return null;
}

/* The sheet's icons are INVENTORY art: each sits on an opaque pure-black
 * slot slab with only the corners transparent. On the floor that slab is a
 * black box stamped over the tiles, so the slab is keyed out once per icon:
 * a flood fill from the border erases connected near-black, and stops at
 * the art. Dark pixels INSIDE the art (outlines, a ring's shadowed hole)
 * are not border-connected and survive. */
const itemIconCache = new Map();

function keyedIcon(img, icon) {
  const hit = itemIconCache.get(icon);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(img, (icon % 8) * 64, Math.floor(icon / 8) * 64, 64, 64, 0, 0, 64, 64);
  const id = g.getImageData(0, 0, 64, 64);
  const d = id.data;
  const seen = new Uint8Array(64 * 64);
  const q = [];
  for (let x = 0; x < 64; x++) q.push(x, 63 * 64 + x);
  for (let y = 0; y < 64; y++) q.push(y * 64, y * 64 + 63);
  while (q.length) {
    const p = q.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    /* The slab is pure black, so anything above near-zero is art; a tight
     * threshold keeps dark art (staff shafts, pendant cords) while the
     * slab and its anti-aliased edge still go. */
    if (d[i + 3] !== 0 && d[i] + d[i + 1] + d[i + 2] >= 10) continue;
    d[i + 3] = 0;
    const x = p % 64, y = (p / 64) | 0;
    if (x > 0) q.push(p - 1);
    if (x < 63) q.push(p + 1);
    if (y > 0) q.push(p - 64);
    if (y < 63) q.push(p + 64);
  }
  g.putImageData(id, 0, 0);
  itemIconCache.set(icon, c);
  return c;
}

/* An item lies ON its tile: the icon is drawn a whisker above the diamond's
 * centre, small enough that two adjacent drops never merge into a heap. */
/* A thing lying on the floor is a thing, not a monument. At 40 it stood
 * two-thirds the height of a tile and read as furniture — a gem on the
 * ground looked like a boulder of sapphire. Half that sits it in the
 * dirt at about the size of the hand that would pick it up. */
const ITEM_ICON_SIZE = 20;

function drawIsoItem(it) {
  const icon = itemIconIndex(it.i);
  const img = icon === null ? null : getIconSheet();
  if (icon === null || !img) {
    drawIsoGlyph(it.x, it.y, (it.i && it.i.glyph) || '$', cls((it.i && it.i.color) || 'gold'), 0);
    return;
  }
  const { sx, sy } = isoToScreen(it.x, it.y);
  const ax = sx - isoCamX, ay = sy - isoCamY;
  const S = ITEM_ICON_SIZE;
  /* Sat on the tile's own centre now rather than floating above it: the
   * old +12 lift was tuned to a sprite twice this tall. */
  els.ctx.drawImage(keyedIcon(img, icon), ax - S / 2, ay - S + 6, S, S);
}

/* STAIRS, drawn by hand in the scene's own prism language. The atlas
 * offered chains where the map statistics promised stairs, and a dais
 * where the eye wanted steps — so the steps are built here instead, from
 * the same flat-shaded stone as the stubs. A flight of four treads climbs
 * toward whichever wall the stairwell leans on; the way down is the same
 * flight sinking through the floor into the dark. */
function drawIsoStairs(g, t, theme, down) {
  const ctx = els.ctx;
  const vis = g.vis && g.vis[t.y] && g.vis[t.y][t.x];
  const { sx, sy } = isoToScreen(t.x, t.y);
  const ax = sx - isoCamX, ay = sy - isoCamY;
  const hw = ISO.TW / 2, hh = ISO.TH / 2;
  const N = [ax, ay - hh], E = [ax + hw, ay], S = [ax, ay + hh], W2 = [ax - hw, ay];
  const wallAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H &&
    (g.currentFloor.tiles[y][x] === T.WALL || g.currentFloor.tiles[y][x] === T.SECRET);
  /* The flight climbs toward a wall when one stands beside it. */
  const toNE = wallAt(t.x, t.y - 1) || !wallAt(t.x - 1, t.y);
  const startA = toNE ? W2 : E, startB = S;
  const endA = N, endB = toNE ? E : W2;
  const lerp = (P, Q, fr) => [P[0] + (Q[0] - P[0]) * fr, P[1] + (Q[1] - P[1]) * fr];
  const steps = 4;
  const rise = down ? -26 : 22;
  const f = vis ? 1 : 0.7;
  if (down) fillDiamond(ctx, ax, ay, '#020302', 0.9);   /* the opening */
  for (let k = steps - 1; k >= 0; k--) {
    const f0 = k / steps, f1 = (k + 1) / steps;
    const h0 = (k / (steps - 1)) * rise;
    const hPrev = ((k - 1) / (steps - 1)) * rise;
    const A0 = lerp(startA, endA, f0), B0 = lerp(startB, endB, f0);
    const A1 = lerp(startA, endA, f1), B1 = lerp(startB, endB, f1);
    if (k > 0) {
      ctx.fillStyle = shade(theme.wall, (down ? Math.max(0.2, 0.6 - k * 0.1) : 0.72) * f);
      ctx.beginPath();
      ctx.moveTo(A0[0], A0[1] - hPrev);
      ctx.lineTo(B0[0], B0[1] - hPrev);
      ctx.lineTo(B0[0], B0[1] - h0);
      ctx.lineTo(A0[0], A0[1] - h0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = shade(theme.wallHi, (down ? Math.max(0.25, 0.9 - k * 0.16) : 1.06 - k * 0.06) * f);
    ctx.beginPath();
    ctx.moveTo(A0[0], A0[1] - h0);
    ctx.lineTo(B0[0], B0[1] - h0);
    ctx.lineTo(B1[0], B1[1] - h0);
    ctx.lineTo(A1[0], A1[1] - h0);
    ctx.closePath();
    ctx.fill();
  }
}

/* GROUND YOU HAVE ONLY READ ABOUT.
 *
 * A chart tells you a room is there; it does not tell you what is on the
 * floor of it, and after reading one there was no way to tell the drawn part
 * of the map from the walked part — which for a floor you are halfway
 * through is the entire use of a map.
 *
 * So charted ground is not painted at all: no tileset art, no theme cast,
 * just the cold outline of the diamond on near-black, the way the log has
 * always described it ("ghost-lines crawl across the floor map"). Nothing
 * about it can be mistaken for a place you have stood, and the moment
 * anyone lays eyes on the tile the engine clears the flag and the real
 * floor arrives underfoot. */
const CHART_INK = '#6fa9c8';

function drawIsoChart(ctx, ax, ay) {
  fillDiamond(ctx, ax, ay, '#0a0f14', 0.85);
  const pts = diamondPath(ax, ay);
  ctx.save();
  ctx.strokeStyle = CHART_INK;
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawIsoGround(g, t, tset, theme, sa) {
  const ctx = els.ctx;
  const floor = g.currentFloor;
  const tile = floor.tiles[t.y][t.x];
  if (tile === T.WALL || tile === T.SECRET) return;   /* prisms, not ground */
  const vis = g.vis && g.vis[t.y] && g.vis[t.y][t.x];
  if (!vis && g.charted && g.charted[t.y] && g.charted[t.y][t.x]) {
    const c = isoToScreen(t.x, t.y);
    drawIsoChart(ctx, c.sx - isoCamX, c.sy - isoCamY);
    /* The stairs still announce themselves — knowing where the way down is
     * is most of why anyone reads a chart. */
    if (tile === T.DOWN || tile === T.UP) {
      ctx.fillStyle = CHART_INK;
      ctx.fillText(tile === T.DOWN ? '>' : '<', c.sx - isoCamX, c.sy - isoCamY);
    }
    return;
  }
  const { sx, sy } = isoToScreen(t.x, t.y);
  const ax = sx - isoCamX, ay = sy - isoCamY;
  let painted = false;
  if (tset && tile !== T.WATER) {
    const r = tset.def.tiles[floorPieceId(tset.def, t.x, t.y)];
    if (r) {
      ctx.drawImage(tset.img, r.x, r.y, r.w, r.h, ax - r.ox, ay - r.oy, r.w, r.h);
      painted = true;
    }
  }
  if (!painted && tile !== T.WATER) {
    fillDiamond(ctx, ax, ay, theme.floor);
  }
  if (tile === T.WATER) {
    fillDiamond(ctx, ax, ay, sa ? '#14202e' : '#18263a');
    if (vis) { ctx.fillStyle = '#3f6faa'; ctx.fillText('~', ax, ay); }
  } else if (painted) {
    /* the theme's cast, so eleven dungeons do not share one grey floor */
    fillDiamond(ctx, ax, ay, theme.floor, 0.18);
  }
  if (!vis) fillDiamond(ctx, ax, ay, '#000000', 0.38);
  if (tile === T.DOWN || tile === T.UP) {
    ctx.fillStyle = vis ? theme.accent : shade(theme.accent, 0.6);
    ctx.fillText(tile === T.DOWN ? '>' : '<', ax, ay);
  } else if (tile === T.ALTAR) {
    ctx.fillStyle = '#e0c05a';
    ctx.fillText('Ω', ax, ay);
  } else if (tile === T.DEN) {
    ctx.fillStyle = theme.wallHi;
    ctx.fillText('O', ax, ay);
  } else if (tile === T.DOOR_O) {
    traceDiamond(ctx, ax, ay);
    ctx.strokeStyle = theme.door;
    ctx.stroke();
  }
}

/* Which atlas pieces are walls, mined from Flare's own maps: the object
 * layer of every alpha_demo dungeon and cave was cross-checked against its
 * collision layer, and each blocking id classified by whether its placements
 * run along world x (broad face to the screen's lower left) or world y
 * (face to the lower right). The dungeon builds in low masonry you can see
 * over; the caves stand in crags, which is why their cutaway cone reaches
 * deeper. */
const WALL_VOCAB = {
  /* 81/80 are the TEXTURED low walls; 83/82/91/95, the statistically more
   * common picks, turned out on inspection to be Flare's shadow-bodied
   * variants — carved crown, pure black face, the source of every "black
   * slab where a wall should be" report since the masonry landed. A
   * corner shows BOTH textured faces, one piece over the other. */
  tileset_dungeon: { x: [81], y: [80], corner: [80, 81], rise: 145 },
  /* The caverns, from Flare's OWN GUIDE rather than from guessing.
   *
   * A tilesetdef carries no names, but the project ships Tiled
   * AUTOMAPPING rules — tiled/cave/rules/cave_ruleset1.tmx — whose
   * output layers say which piece answers which wall configuration.
   * Decoded (Tiled grid index + 16 = the def's id), the straight walls
   * come in two varieties of four directions each: 64/65/66/67 and
   * 68/69/70/71. That is also why half of them measured 97-99% black —
   * they are the two directions seen FROM BEHIND, which this camera
   * never shows and this renderer never asks for. The near pair of each
   * variety is what belongs here, and having two varieties is what stops
   * a long wall repeating one silhouette down its length. */
  tileset_cave: { x: [65, 69], y: [64, 68], corner: [96], inner: [100, 101], rise: 300, grounded: true, squash: 0.55 },
  /* tileset_cave WAS absent, and cave themes drew NO wall art
   * at all — the painted prisms in the theme's own colours are the walls.
   * Every art route was tried and audited first: the cave set's walls are
   * shadow-bodied slabs (one lit facet on pure black), and standing the
   * grassland's four clean bluffs one-per-tile made a forest of giant
   * monuments ("distractingly bad" — the playtest, correctly). Flare's
   * cliff art is authored for continuous composition this renderer does
   * not do. Clean geometry beats wrong art; the cave atlas lays FLOORS. */
  /* The bluffs, read out of Flare's OWN rules at last rather than picked
   * by how clean they measured — which is how the town ended up walled in
   * cones and flat tan sheets.
   *
   * tiled/grassland/rules/ holds four automapping rulesets. Decoded (the
   * grassland tileset's firstgid is 16, exactly where its def starts, so
   * a Tiled gid IS the def id here — no offset, unlike the cave's), their
   * output_object layers say it plainly: 48-51 and 52-55 are the STRAIGHT
   * runs, four directions in two varieties; 56-71 are the CORNERS.
   *
   * Every piece the old vocabulary used was therefore the wrong kind of
   * thing. 64 and 68 are corner outputs — they measured cleanest of the
   * range, which is why picking by measurement alone chose them, and they
   * were laid down the length of a straight wall, where a corner is a
   * spire. And 72 is not in any output layer at all: it is a ramp, which
   * is exactly what those flat tan quadrilaterals in the town were.
   *
   * Which of the four straights face this camera was settled on the
   * composition rig, not by eye: a run of four laid along world x and
   * again along world y, where the right piece reads as one continuous
   * rock face and the wrong one as a row of jagged teeth. 49 and 53
   * compose along x, 48 and 52 along y. The other two of each variety are
   * the same walls seen from behind (95% black, the same signature the
   * cave's 66/67/70/71 carry), which this camera never shows.
   *
   * Two varieties per axis so a long wall does not repeat one silhouette,
   * and the corner stacks one of each facing — the dungeon masonry's own
   * trick, and it means the corner needs no fifth measurement to trust. */
  tileset_grassland: { x: [49, 53], y: [48, 52], corner: [48, 49], rise: 245, grounded: true },
  /* The note that retired them, kept because the reasoning still holds for
   * the reason was MEASURED rather than eyeballed this time: counting
   * near-black opaque pixels per piece across the whole bluff range, the
   * two I had trusted as "fully painted broad caps" — 56 and 60 — are
   * 46% pure black, and only the spires 64/68 (6-7%) and the little
   * ramps 72-75 (0-3%) are actually clean. Flare's cliff art buries each
   * piece's black backside under the next piece of a continuous cliff;
   * standing them one to a tile shows it, in a hamlet exactly as in a
   * cavern. The treeline wears the painted prisms now, in the town
   * theme's own colours — the same verdict the dungeons got, applied to
   * the same art for the same reason. The grassland atlas keeps its real
   * gifts: the turf underfoot and the props standing on it. */
  /* The houses: Clint Bellanger's medieval building tiles — timber frame,
   * wattle, red tile roofs — made for OSARE on this exact 64x32 grid,
   * under the same CC-BY-SA as the rest of the Flare art. */
  medieval_building_tiles: { x: [13, 29], y: [12, 28], corner: [1], filler: [50], rise: 176 },
};

/* Which piece a wall tile wears — or null, and null is the ToEE cutaway
 * carried to its conclusion: a wall whose visible faces (south and east,
 * the ones this camera can see) touch no open floor is not drawn at all.
 * Rooms keep their far walls and lose their near ones, and the party is
 * never hidden behind masonry that exists only to be in the way. */
function wallPieceId(vocab, g, t) {
  const floor = g.currentFloor;
  const openAt = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const tt = floor.tiles[y][x];
    return tt !== T.WALL && tt !== T.SECRET && g.seen[y] && g.seen[y][x];
  };
  const openS = openAt(t.x, t.y + 1);
  const openE = openAt(t.x + 1, t.y);
  const h = ((t.x * 40503) ^ (t.y * 44417)) >>> 0;
  if (openS && openE) return vocab.corner || null;
  /* A thin wall between two north-south corridors is seen from BOTH sides:
   * its east face gets the lit piece, but the camera also sees its west
   * flank, which on a one-face piece is the artist's unpainted back — a
   * flat wash-coloured slab ("the unfinished sides of the artwork"). Layer
   * the two facings, the dungeon corner's own trick, so both flanks wear
   * rock. Only the west side can leak this way: a north back faces away
   * from this camera entirely. */
  if (openE && vocab.twoFaced && openAt(t.x - 1, t.y)) {
    return [vocab.x[h % vocab.x.length], vocab.y[h % vocab.y.length]];
  }
  /* SOME ART ONLY COMPOSES IN A RUN. The cave crags are painted on one
   * face with a dark margin the NEXT piece along the wall is meant to
   * cover — proven on the composition rig, where a run of four reads as
   * one continuous rock face and a single piece reads as a black slab
   * with a rock stripe. So a lone wall tile, or the end of a run, wears
   * the painted prism instead: honest geometry beats a black hole. */
  const sameAxis = (dx, dy) => {
    const nx = t.x + dx, ny = t.y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    const tt = floor.tiles[ny][nx];
    return (tt === T.WALL || tt === T.SECRET) && g.seen[ny] && g.seen[ny][nx];
  };
  if (openS) {
    if (vocab.runsOnly && !(sameAxis(1, 0) && sameAxis(-1, 0))) return null;
    return [vocab.x[h % vocab.x.length]];
  }
  if (openE) {
    if (vocab.runsOnly && !(sameAxis(0, 1) && sameAxis(0, -1))) return null;
    return [vocab.y[h % vocab.y.length]];
  }
  /* THE INNY CORNER. Where two runs meet at an inside angle, the tile
   * shows no face south and none east — the open ground is DIAGONAL from
   * it — so it fell through to a faceless mass and left a notch of bare
   * block in an otherwise carved wall. Flare paints these: the automap
   * ruleset's other corner group, 100/101. */
  if (vocab.inner && openAt(t.x + 1, t.y + 1)) {
    return [vocab.inner[h % vocab.inner.length]];
  }
  /* A tile with no visible face: for building sets, the roof over the
   * body of the house; for dungeon masonry, nothing (the stub answers). */
  if (vocab.filler) return [vocab.filler[h % vocab.filler.length]];
  return null;
}

/* How tall a wall stands when it is cut down: enough to read as a wall
 * stump under any light, never enough to hide a tile of floor. */
const STUB_H = 13;

function drawIsoWall(g, t, tile, theme, sa, tset, stub) {
  const vis = g.vis && g.vis[t.y] && g.vis[t.y][t.x];
  /* Cut stone is still stone: a stub wears the colour of the set's own
   * rock, not the theme's swatch, or the cutaway leaves pale blocks
   * standing in a dark cavern — which is the whole complaint. */
  const tone = rockToneOf(tset) || theme.wall;
  const { sx, sy } = isoToScreen(t.x, t.y);
  const ax = sx - isoCamX, ay = sy - isoCamY;
  const ctx = els.ctx;
  const door = tile === T.DOOR_C;
  /* THE CUT WALL. Not removed, not turned to glass — cut down to a stub,
   * the way ToEE actually did it. Removal left black voids nobody could
   * read as anything ("cannot tell what is going on, or which direction I
   * can walk" — the playtest, verbatim), and glass stacked into milk where
   * pieces overlapped. A stub is opaque, short, and honest: wall here,
   * room behind it, floor everywhere the stub is not. */
  if (stub) {
    const sf = vis ? 1 : 0.7;
    /* A DOOR KNEELS TOO. It stood at full height while every wall around
     * it lay down, which is the one thing T exists to prevent — but a
     * door cut to a stub is indistinguishable from wall, so it keeps its
     * timber colour and wears a mark: the threshold, drawn as a bar
     * across the opening. */
    if (door) {
      drawPrism(ctx, ax, ay, Math.round(STUB_H * 0.55),
        shade('#6b4a2a', 1.15 * sf), shade('#6b4a2a', 0.9 * sf), shade('#4e351d', 0.75 * sf));
      if (vis) {
        ctx.fillStyle = shade('#c8a34a', sf);
        ctx.fillRect(ax - 5, ay - Math.round(STUB_H * 0.55) - 1, 10, 2);
      }
      return;
    }
    drawPrism(ctx, ax, ay, STUB_H,
      shade(tone, 0.72 * sf), shade(tone, 0.55 * sf), shade(tone, 0.4 * sf));
    if (tile === T.SECRET && vis && sa === 0) {
      ctx.fillStyle = theme.accent;
      ctx.fillText('+', ax, ay - STUB_H);
    }
    return;
  }
  const f = vis ? 1 : 0.45;
  if (!door && tset) {
    const vocab = WALL_VOCAB[tset.name];
    if (vocab) {
      const ids = wallPieceId(vocab, g, t);
      if (ids !== null) {
        let drew = false;
        const ga = ctx.globalAlpha;
        /* Unlit stone dims but stays legible: walls are the shape of the
         * map, and the floor's own darkness already says "not lit". */
        ctx.globalAlpha = ga * (vis ? 1 : 0.5);
        /* THE WALLS WERE THREE TIMES LIFE, ALL ALONG. Flare draws for a
         * 192-pixel diamond and ours is 64: every wall sprite is ~178
         * wide, so each piece sprawled across three tiles. A continuous
         * run of masonry survived it — like the bleeding floor, overlap
         * reads as texture — but standing pieces one to a tile turned the
         * caverns into a black mountain range and the bluffs into a
         * forest of monuments. The props were scaled to the grid; the
         * walls never were. */
        const s = atlasScale(tset);
        /* NO PRISM UNDER THE ART. One was drawn here to fill whatever the
         * keyed sprite left transparent — and since a wall sprite is
         * taller and narrower than its tile's box, what actually showed
         * was the box: a row of flat pink blocks standing behind the
         * stone. Where the art paints, the art is the wall; where it does
         * not, the tile behind it is the honest answer. */
        for (const id of ids) {
          const kp = getKeyedPiece(tset, id);
          if (!kp) continue;
          /* grounded: the piece's base may not cross its tile's front
           * vertex (ay + TH/2) — see the vocab comment. Lift, never sink. */
          /* Flare's crags stand four tiles tall on a 192px grid, which is
           * right for its camera and reads as double height on ours — the
           * scene is a room, not a canyon. `squash` shortens the piece
           * without narrowing it, so the stone keeps its width and its
           * footing and only loses the cliff. */
          const q = vocab.squash || 1;
          const sy = s * q;
          const lift = vocab.grounded ? Math.max(0, (kp.h - kp.oy) * sy - ISO.TH / 2) : 0;
          ctx.drawImage(kp.img, 0, 0, kp.w, kp.h,
            ax - kp.ox * s, ay - kp.oy * sy - lift, kp.w * s, kp.h * sy);
          drew = true;
        }
        ctx.globalAlpha = ga;
        if (drew) {
          if (tile === T.SECRET && vis && sa === 0) {
            ctx.fillStyle = theme.accent;
            ctx.fillText('+', ax, ay - ISO.WALL_H);
          }
          return;
        }
      }
      /* No visible face from this side: the stub again, never a void.
       * (Its own shade, named apart from the wall's `f` above — a second
       * `const f` in this block put the whole block in the dead zone.) */
      const sf = vis ? 1 : 0.7;
      drawPrism(ctx, ax, ay, STUB_H,
        shade(tone, 0.2 * sf), shade(tone, 0.15 * sf), shade(tone, 0.11 * sf));
      return;
    }
  }
  if (door) { drawIsoDoor(ctx, ax, ay, theme, f, g, t); return; }
  drawPrism(ctx, ax, ay, ISO.WALL_H, shade(tone, 0.8 * f), shade(tone, 0.62 * f), shade(tone, 0.45 * f));
  if (tile === T.SECRET && vis && sa === 0) {
    ctx.fillStyle = theme.accent;
    ctx.fillText('+', ax, ay - ISO.WALL_H);
  }
}

/* A DOOR THAT LOOKS LIKE A DOOR.
 *
 * There is none in the atlas — Flare keeps its doors in event tilesets we
 * never extracted — and the fallback was a prism one shade off the wall
 * and a little shorter, which read as "wall, slightly wrong" ("no door
 * graphic"). So it is drawn: a stone jamb at wall height, a timber leaf
 * standing in it, plank seams down the grain, and a handle. Same trick as
 * the stairs, and for the same reason. */
function drawIsoDoor(ctx, ax, ay, theme, f, g, t) {
  const hw = ISO.TW / 2, hh = ISO.TH / 2;
  const H_ = ISO.WALL_H;
  /* Which way the passage runs, so the leaf hangs in it. A door drew a
   * leaf on BOTH visible faces before, which read as two doors meeting at
   * a corner — a doorway has one door, and it faces the way you walk. */
  let west = true;
  if (g && t && g.currentFloor) {
    const tiles = g.currentFloor.tiles;
    const walk = (x, y) => {
      const q = tiles[y] && tiles[y][x];
      return q !== undefined && q !== T.WALL && q !== T.SECRET;
    };
    /* Screen-left is the tile's SOUTH face, screen-right its EAST. A
     * passage running north-south is closed by a door you see on the
     * south face — the left one. East-west, and it is the right. */
    west = walk(t.x, t.y - 1) && walk(t.x, t.y + 1);
  }
  /* The jamb: the masonry the door is set into, at full wall height so the
   * wall line stays unbroken from across the room. */
  drawPrism(ctx, ax, ay, H_, shade(theme.wallHi, f), shade(theme.wall, 0.8 * f), shade(theme.wall, 0.55 * f));
  const leafH = Math.round(H_ * 0.76);
  const inset = 0.2;
  const dx = west ? -hw : hw;                  /* the face the leaf hangs on */
  const x0 = ax + dx * (1 - inset);
  const y0 = ay + Math.abs(dx * (1 - inset)) * (hh / hw) * (dx < 0 ? -1 : -1);
  /* The quad from the tile's side vertex to its front vertex, inset. */
  const nearY = ay + hh * (1 - inset);
  ctx.fillStyle = shade(west ? '#6b4a2a' : '#5d3f24', f);
  ctx.beginPath();
  ctx.moveTo(x0, ay + (y0 - ay) * 0);
  ctx.lineTo(ax, nearY);
  ctx.lineTo(ax, nearY - leafH);
  ctx.lineTo(x0, ay - leafH);
  ctx.closePath();
  ctx.fill();
  /* Plank seams down the grain. */
  ctx.strokeStyle = shade('#2e1e10', f);
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const tt = i / 3;
    const px = x0 + (ax - x0) * tt;
    const py = ay + (nearY - ay) * tt;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - leafH);
    ctx.stroke();
  }
  /* The handle, at hand height near the leading edge. */
  ctx.fillStyle = shade('#c8a34a', f);
  const hxp = x0 + (ax - x0) * 0.8;
  const hyp = ay + (nearY - ay) * 0.8 - Math.round(leafH * 0.45);
  ctx.beginPath();
  ctx.arc(hxp, hyp, 1.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawIsoMonster(g, m, p) {
  const dim = !inView(m.x, m.y) || m.submerged;
  const tint = cls(monsterTint(m.t.tier, m.boss));
  const { sx, sy } = isoToScreen(m.x, m.y);
  const ax = sx - isoCamX, ay = sy - isoCamY + 4;
  const sheet = CREATURE_SHEETS[m.t.id];
  const entry = sheet ? getSheet('creature', sheet) : null;
  if (entry) {
    drawRingAt(ax, ay, ISO.TW * 0.30, ISO.TW * 0.15, tint, { dim, bold: !!m.boss });
    if (drawFrameAt(ax, ay, ISO_UNIT, entry, 'stance', flareDir(p.x - m.x, p.y - m.y), { dim, fit: true, scale: m.boss ? 1.3 : 1 })) return;
  }
  drawIsoGlyph(m.x, m.y, m.t.glyph, dim ? shade(tint, 0.7) : tint, 0);
}

/* The tiles a working reaches, as a test rather than a list, so the caller
 * can ask about a tile's neighbour without building the set twice. */
function reachTest(g, p, reach) {
  if (reach.shape === 'sight') {
    return (x, y) => !!(g.vis && g.vis[y] && g.vis[y][x]);
  }
  const r = reach.radius;
  if (reach.metric === 'manhattan') {
    return (x, y) => Math.abs(x - p.x) + Math.abs(y - p.y) <= r;
  }
  return (x, y) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= r;
}

function drawIsoReach(g, p) {
  if (!rangeRings.size || !p) return;
  const ctx = els.ctx;
  const floor = g.currentFloor;
  if (!floor) return;
  for (const a of g.allAbilities(p)) {
    if (!rangeRings.has(a.id)) continue;
    const reach = abilityReach(a);
    if (!reach) continue;
    const inside = reachTest(g, p, reach);
    /* Only as far as the ring could possibly go: the whole floor for a
     * sight-bounded working, a box around the caster for the rest. */
    const rad = reach.shape === 'sight' ? Math.max(W, H) : reach.radius + 1;
    const x0 = Math.max(0, p.x - rad), x1 = Math.min(W - 1, p.x + rad);
    const y0 = Math.max(0, p.y - rad), y1 = Math.min(H - 1, p.y + rad);
    ctx.save();
    ctx.strokeStyle = ringColour(a.id);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        const s = isoToScreen(x, y);
        const c = diamondPath(s.sx - isoCamX, s.sy - isoCamY);
        /* The diamond's corners run top, right, bottom, left — so the edge
         * shared with the neighbour one step along world x is right-to-
         * bottom, and along world y is bottom-to-left. */
        if (!inside(x + 1, y)) { ctx.moveTo(c[1][0], c[1][1]); ctx.lineTo(c[2][0], c[2][1]); }
        if (!inside(x, y + 1)) { ctx.moveTo(c[2][0], c[2][1]); ctx.lineTo(c[3][0], c[3][1]); }
        if (!inside(x - 1, y)) { ctx.moveTo(c[3][0], c[3][1]); ctx.lineTo(c[0][0], c[0][1]); }
        if (!inside(x, y - 1)) { ctx.moveTo(c[0][0], c[0][1]); ctx.lineTo(c[1][0], c[1][1]); }
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

function renderIsoScene(g, sa) {
  const ctx = els.ctx;
  const floor = g.currentFloor;
  const p = g.state.player;
  const dungeon = g.dungeonById(p.dungeonId) || {};
  const town = g.inTown && g.inTown();
  const theme = getTheme(town ? 'town' : dungeon.theme);
  /* The scene is drawn in its own pixels; the zoom and the device's pixel
   * density are one transform over the lot — the viewport just covers more
   * or less of it, and every source pixel of the art reaches the glass. */
  const view = pixelScale * isoZoom;
  const cw = els.canvas.width / view, ch = els.canvas.height / view;
  const centre = isoToScreen(p.x, p.y);
  isoCamX = centre.sx - cw / 2;
  isoCamY = centre.sy - ch / 2;
  const tset = getTileset(town ? 'tileset_grassland' : (THEME_TILESET[dungeon.theme] || 'tileset_dungeon'));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getUnknownPattern(ctx);
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.setTransform(view, 0, 0, view, 0, 0);
  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const test = makeViewTest(isoCamX, isoCamY, isoCamX + cw, isoCamY + ch);
  const seenTiles = [];
  for (let y = 0; y < H; y++) {
    const row = g.seen && g.seen[y];
    if (!row) continue;
    for (let x = 0; x < W; x++) {
      if (row[x] && test(x, y)) seenTiles.push({ x, y });
    }
  }
  seenTiles.sort(paintOrder);

  /* Ground known only from a chart. Nothing that belongs to the real floor
   * may be drawn on it — not the stair art, not the bones in the corners,
   * not the rock caps that seal a wall mass — or the chart quietly starts
   * claiming to know things a chart cannot tell you. */
  const hearsay = (t) => !!(g.charted && g.charted[t.y] && g.charted[t.y][t.x]) &&
    !(g.vis && g.vis[t.y] && g.vis[t.y][t.x]);

  for (const t of seenTiles) drawIsoGround(g, t, tset, theme, sa);

  /* The stairs draw AFTER all the ground: the painterly floor pieces bleed
   * over their neighbours by design, and a flight drawn in the ground pass
   * was buried under the next tile's stone. Still under every body. */
  for (const t of seenTiles) {
    if (hearsay(t)) continue;
    const tt = floor.tiles[t.y][t.x];
    if (tt === T.UP || tt === T.DOWN) drawIsoStairs(g, t, theme, tt === T.DOWN);
  }

  /* Flat props — the worn paths — lie on the ground the same way, under
   * every foot that walks them. */
  for (const pr of floor.props || []) {
    if (!pr.flat) continue;
    const img = getProp(pr.piece);
    if (!img) continue;
    const a = isoToScreen(pr.x, pr.y);
    const sc = (ISO.TW / 256) * 1.05;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img, a.sx - isoCamX - (img.width * sc) / 2,
      a.sy - isoCamY + ISO.TH / 2 - img.height * sc, img.width * sc, img.height * sc);
    ctx.globalAlpha = 1;
  }

  /* THE DEAD OF THE TEMPLE. Flare's bone pieces — looked at before being
   * wired in, a lesson the chains taught — scattered on about one floor
   * tile in twenty-five, position-hashed so the same corpse lies in the
   * same doorway for ever. Dungeon masonry only; the caves keep their own
   * counsel until their set is curated. */
  if (tset && tset.name === 'tileset_dungeon' && !town) {
    const BONES = [176, 177, 180, 181, 182, 183];
    for (const t of seenTiles) {
      if (hearsay(t)) continue;
      if (floor.tiles[t.y][t.x] !== T.FLOOR) continue;
      const h = ((t.x * 92821) ^ (t.y * 68917)) >>> 0;
      if (h % 25 !== 0) continue;
      const r = tset.def.tiles[BONES[(h >> 5) % BONES.length]];
      if (!r) continue;
      const a = isoToScreen(t.x, t.y);
      const vis = g.vis[t.y] && g.vis[t.y][t.x];
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * (vis ? 0.95 : 0.5);
      const bs = atlasScale(tset);
      ctx.drawImage(tset.img, r.x, r.y, r.w, r.h,
        a.sx - isoCamX - r.ox * bs, a.sy - isoCamY - r.oy * bs, r.w * bs, r.h * bs);
      ctx.globalAlpha = ga;
    }
  }

  /* THE REACH OF A WORKING, on the ground where the decision is made.
   *
   * Outlined, never filled: a filled disc of nine tiles' radius washes out
   * the floor it is supposed to help you read, and the only line that
   * carries information is the last one — where the working stops. So the
   * region is walked and an edge drawn wherever a tile inside it touches a
   * tile outside, which draws the true shape of whatever metric the
   * ability measures with, diagonals and all, rather than an ellipse that
   * happens to be about right.
   *
   * Centred on the member whose card is open, since that is whose reach
   * you ticked — not on whoever holds the reins. */
  drawIsoReach(g, viewedMember(g));

  /* the route, drawn on the ground so the standing world occludes it */
  const preview = !(walkPath && walkPath.length) && hoverPath && hoverPath.length;
  const dots = (walkPath && walkPath.length) ? walkPath
    : (preview ? hoverPath.slice(0, -1) : null);
  if (dots) {
    const styles = preview ? routeDotStyles(g, hoverPath) : null;
    dots.forEach((st, i) => {
      const d = isoToScreen(st.x, st.y);
      ctx.fillStyle = styles && styles[i] ? 'rgba(224, 96, 80, 0.85)' : 'rgba(230, 220, 160, 0.45)';
      ctx.beginPath();
      ctx.arc(d.sx - isoCamX, d.sy - isoCamY, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const hovered = hoverTile && g.seen && g.seen[hoverTile.y] && g.seen[hoverTile.y][hoverTile.x]
    ? hoverTile : null;
  const hostileHover = hovered && monsterAtTile(g, hovered.x, hovered.y);
  if (hovered) {
    const hc = isoToScreen(hovered.x, hovered.y);
    traceDiamond(ctx, hc.sx - isoCamX, hc.sy - isoCamY);
    ctx.strokeStyle = hostileHover ? 'rgba(224, 96, 80, 0.9)' : 'rgba(230, 220, 160, 0.8)';
    ctx.stroke();
  }

  /* everything that stands, painted back to front */
  const standers = [];
  /* Walls that would hide a member of the company turn to glass instead —
   * the ToEE cutaway. The cone: anything standing up to four rows in front
   * of a body and within two files of it. */
  /* The cutaway, computed as occlusion: every wall piece tall enough to
   * stand between the camera and any floor the party has SEEN is cut down
   * to a stub. The depth of the shadow comes from the art itself — how many
   * screen rows a piece's height reaches back over. Explored ground stays
   * legible everywhere; the walls the camera looks at from the north keep
   * their full carved height, because they hide nothing. */
  /* The hamlet builds in timber and tile: houses draw from the medieval
   * building set; the treeline keeps the grassland's rock. */
  const wtset = town ? getTileset('medieval_building_tiles') : tset;
  /* What colour a faceless wall mass wears: the average of the stone the
   * set actually paints, so a block reads as the same rock seen without
   * its lit face — never as a swatch from a different palette. */
  const rockTone = rockToneOf(wtset) || theme.wall;
  /* The cutaway's reach is a screen distance, so it scales with the art. */
  const riseRaw = (wtset && WALL_VOCAB[wtset.name] && WALL_VOCAB[wtset.name].rise) || ISO.WALL_H;
  const rise = wtset && WALL_VOCAB[wtset.name]
    ? riseRaw * atlasScale(wtset) * (WALL_VOCAB[wtset.name].squash || 1)
    : riseRaw;
  const depth = Math.ceil(rise / (ISO.TH / 2));
  /* THE CUTAWAY CUTS FOR THE COMPANY, NOT FOR THE FLOOR.
   *
   * Every seen tile of ground used to cast the cone, which meant nearly
   * every wall facing the camera was cut to a stub — a room of standing
   * stone read as a room of kerbs, and walls vanished for no reason the
   * player could see ("if it is on screen, it should be visible"). Only
   * bodies need to be seen through a wall: the company, and whatever is
   * awake and looking at them. Everything else keeps its full height. */
  const shadow = new Set();
  const watchers = [];
  for (const m of g.state.party.members) {
    if (m && m.hp > 0 && m.floorIdx === p.floorIdx && m.dungeonId === p.dungeonId) watchers.push(m);
  }
  for (const mo of floor.monsters || []) {
    if (mo.hp > 0 && !mo.submerged && g.vis[mo.y] && g.vis[mo.y][mo.x]) watchers.push(mo);
  }
  for (const w of watchers) {
    const sum = w.x + w.y, diff = w.x - w.y;
    for (let s = 1; s <= depth; s++) {
      for (let d = -1; d <= 1; d++) shadow.add((sum + s) * 512 + (diff + d));
    }
  }
  const ghosts = (wx, wy) => shadow.has((wx + wy) * 512 + (wx - wy));
  for (const t of seenTiles) {
    const tile = floor.tiles[t.y][t.x];
    if (tile !== T.WALL && tile !== T.SECRET && tile !== T.DOOR_C) continue;
    /* Only the shell: a wall with no walkable neighbour in the light is the
     * void, and the void is already the colour of the background. */
    let faces = false;
    for (let dy = -1; dy <= 1 && !faces; dy++) {
      for (let dx = -1; dx <= 1 && !faces; dx++) {
        const nx = t.x + dx, ny = t.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nt = floor.tiles[ny][nx];
        if (nt !== T.WALL && nt !== T.SECRET && g.seen[ny] && g.seen[ny][nx]) faces = true;
      }
    }
    /* THE HOUSES, assembled from the two-column kit worked out on the
     * test rig: a building's west column wears the even pieces, the east
     * column their odd mirrors, doors where the map says, windows and
     * plank variety by position hash. Drawn whole — the cutaway never
     * applies to a cottage, and the x-ray rings carry anyone behind one. */
    /* T kneels the cottages with everything else: with the walls down a
     * house is its footprint in stubs, same as any dungeon wall. */
    const hKey = t.y * W + t.x;
    /* THE GATE. Same kit as the cottages and the same rule about T: with
     * the walls down it kneels with everything else. Two leaves that meet
     * at a ridge, a turret either side, and no way through — there is
     * nothing on the far side of it yet. */
    if (town && wallMode !== 'down' && floor.gateDoors &&
        (floor.gateDoors.has(hKey) || floor.gateTowers.has(hKey))) {
      const med = getTileset('medieval_building_tiles');
      if (med) {
        const id = floor.gateTowers.has(hKey) ? 10
          : (floor.gateDoors.has(t.y * W + (t.x + 1)) ? 14 : 15);
        const r = med.def.tiles[id];
        if (r) {
          standers.push({ x: t.x, y: t.y, draw: () => {
            const a = isoToScreen(t.x, t.y);
            ctx.drawImage(med.img, r.x, r.y, r.w, r.h,
              a.sx - isoCamX - r.ox, a.sy - isoCamY - r.oy, r.w, r.h);
          } });
          continue;
        }
      }
    }
    if (town && wallMode !== 'down' && floor.houseWalls && floor.houseWalls.has(hKey)) {
      const med = getTileset('medieval_building_tiles');
      if (med) {
        const eastIn = floor.houseWalls.has(t.y * W + (t.x + 1));
        const h = ((t.x * 40503) ^ (t.y * 44417)) >>> 0;
        const id = (floor.houseDoors && floor.houseDoors.has(hKey))
          ? (eastIn ? 14 : 15)
          : (eastIn ? [12, 16, 28] : [13, 17, 29])[h % 3];
        const r = med.def.tiles[id];
        if (r) {
          standers.push({ x: t.x, y: t.y, draw: () => {
            const a = isoToScreen(t.x, t.y);
            ctx.drawImage(med.img, r.x, r.y, r.w, r.h,
              a.sx - isoCamX - r.ox, a.sy - isoCamY - r.oy, r.w, r.h);
          } });
          continue;
        }
      }
    }
    /* A wall you have only read about is a line on a chart, not masonry —
     * the same rule the ground follows, so a charted room reads as an
     * outline rather than as somewhere you have walked the perimeter of. */
    if (!town && g.charted && g.charted[t.y] && g.charted[t.y][t.x] &&
        !(g.vis && g.vis[t.y] && g.vis[t.y][t.x])) {
      standers.push({ x: t.x, y: t.y, draw: () => {
        const c = isoToScreen(t.x, t.y);
        drawIsoChart(ctx, c.sx - isoCamX, c.sy - isoCamY);
      } });
      continue;
    }
    if (faces) {
      /* In town the cutaway does not apply: daylight makes every tile
       * "seen", which stubbed every building into a flat ring — a hamlet
       * of foundations. The treeline wears the grassland's rock bluffs. */
      const stub = wallMode === 'down' || (!town && ghosts(t.x, t.y));
      standers.push({ x: t.x, y: t.y, draw: () => drawIsoWall(g, t, tile, theme, sa, town ? tset : wtset, stub) });
    } else {
      /* The interior of a wall mass: no face to show, but a hole would lie.
       * A low dark prism, not a flat shadow — the mass tiles into a stone
       * plateau with visible sides, instead of a cliff of background. */
      const vis = g.vis && g.vis[t.y] && g.vis[t.y][t.x];
      standers.push({ x: t.x, y: t.y, draw: () => {
        const a = isoToScreen(t.x, t.y);
        const f = vis ? 1 : 0.75;
        /* THE BACK OF A WALL IS ROCK, NOT UPHOLSTERY. This mass used to
         * wear the theme's own wall colour at half strength, which beside
         * real painted stone read as slabs of pink furniture standing in
         * the cavern. Unlit rock is nearly black with a hint of the
         * theme, which is what the back of a wall looks like. */
        drawPrism(ctx, a.sx - isoCamX, a.sy - isoCamY, STUB_H,
          shade(rockTone, 0.2 * f), shade(rockTone, 0.15 * f), shade(rockTone, 0.11 * f));
      } });
    }
  }
  /* THE SEALED UNKNOWN. An unexplored tile right behind a seen wall used
   * to render as background — a black gap between the wall's crown and
   * the ground that read as a hole in the world. Cap it as rock: the
   * claim "the wall has thickness here" is always plausible, reveals
   * nothing real about the layout, and closes the voids that made
   * walls-up illegible. */
  const sealed = new Set();
  for (const t of seenTiles) {
    if (hearsay(t)) continue;
    const tt = floor.tiles[t.y][t.x];
    if (tt !== T.WALL && tt !== T.SECRET) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = t.x + dx, ny = t.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (g.seen[ny] && g.seen[ny][nx]) continue;
        const k = ny * W + nx;
        if (sealed.has(k)) continue;
        sealed.add(k);
        standers.push({ x: nx, y: ny, draw: () => {
          const a = isoToScreen(nx, ny);
          drawPrism(ctx, a.sx - isoCamX, a.sy - isoCamY, STUB_H,
            shade(rockTone, 0.3), shade(rockTone, 0.24), shade(rockTone, 0.18));
        } });
      }
    }
  }

  for (const pr of floor.props || []) {
    if (pr.flat) continue;   /* the paths were laid with the ground */
    /* T kneels the WORLD, not only its masonry. A gravestone, a column or
     * a tree stands as tall as a wall and hides as much — a town with its
     * roofs knelt and its churchyard still standing was the same
     * complaint the walls got, wearing different stone. Flat props (the
     * worn paths) are ground and stay. */
    if (wallMode === 'down') continue;
    /* An `atlas` prop is a piece of the floor's own tileset — fences,
     * anvils, gravestones — drawn with the offsets its definition gives. */
    if (pr.atlas) {
      const r = tset && tset.def.tiles[pr.atlas];
      if (!r) continue;
      /* Scaled to the grid, offsets and all: `pr.scale` lets one prop be
       * deliberately bigger than life — a market cross, a standing stone
       * — without lying about the rest. */
      const s = atlasScale(tset) * (pr.scale || 1);
      standers.push({ x: pr.x, y: pr.y, draw: () => {
        const a = isoToScreen(pr.x, pr.y);
        ctx.drawImage(tset.img, r.x, r.y, r.w, r.h,
          a.sx - isoCamX - r.ox * s, a.sy - isoCamY - r.oy * s, r.w * s, r.h * s);
      } });
      continue;
    }
    const img = getProp(pr.piece);
    if (!img) continue;
    standers.push({ x: pr.x, y: pr.y, draw: () => {
      const a = isoToScreen(pr.x, pr.y);
      /* Kenney's pieces were made for a 256px diamond; ours is 64. The
       * picture's own ground sits at its bottom edge. */
      const sc = (ISO.TW / 256) * 1.15;
      ctx.drawImage(img, a.sx - isoCamX - (img.width * sc) / 2,
        a.sy - isoCamY + ISO.TH / 2 - img.height * sc, img.width * sc, img.height * sc);
    } });
  }
  for (const it of floor.items || []) {
    if (!inView(it.x, it.y)) continue;
    standers.push({ x: it.x, y: it.y, draw: () => drawIsoItem(it) });
  }
  for (const n of floor.npcs || []) {
    if (!inView(n.x, n.y)) continue;
    standers.push({ x: n.x, y: n.y, draw: () => drawIsoGlyph(n.x, n.y, NPC_GLYPH, cls((n.tpl && n.tpl.color) || 'amber'), -8) });
  }
  for (const m of floor.monsters || []) {
    if (m.hp <= 0 || !m.t) continue;
    if (m.submerged && !m.revealed) continue;
    if (!inView(m.x, m.y) && !m.revealed) continue;
    standers.push({ x: m.x, y: m.y, draw: () => drawIsoMonster(g, m, p) });
  }
  g.state.party.members.forEach((m, i) => {
    if (!m) return;
    if (m.floorIdx !== p.floorIdx || m.dungeonId !== p.dungeonId) return;
    standers.push({ x: m.x, y: m.y, draw: () => {
      const a = isoToScreen(m.x, m.y);
      const drew = drawMemberAt(a.sx - isoCamX, a.sy - isoCamY + 4, ISO_UNIT, ISO.TW * 0.30, ISO.TW * 0.15, m, tintOf(m, i), m === p);
      if (!drew) drawIsoGlyph(m.x, m.y, PLAYER_GLYPH, m.hp > 0 ? tintOf(m, i) : '#7a3a30', 0);
    } });
  });
  standers.sort(paintOrder);
  for (const sd of standers) sd.draw();

  /* THE X-RAY RING, straight out of ToEE: whatever stands between the
   * camera and a member of the company, their circle rides above it. The
   * body may duck behind a wall stub or a stair; where they ARE never
   * does. */
  g.state.party.members.forEach((m, i) => {
    if (!m || m.hp <= 0) return;
    if (m.floorIdx !== p.floorIdx || m.dungeonId !== p.dungeonId) return;
    const a = isoToScreen(m.x, m.y);
    drawRingAt(a.sx - isoCamX, a.sy - isoCamY + 4, ISO.TW * 0.30, ISO.TW * 0.15,
      tintOf(m, i), { dim: true, bold: m === p });
  });

  /* WHOSE TURN IT IS, on the board: in a fight a chevron hangs over the
   * head of the member holding the reins, in their own tint — the same
   * colour as their ring, their nameplate and their name in the top bar.
   * The strip and the bar say it in the margins; this says it where your
   * eyes already are. */
  if (!g.outOfCombat() && p && p.hp > 0) {
    const a = isoToScreen(p.x, p.y);
    const ax = a.sx - isoCamX, ay = a.sy - isoCamY;
    ctx.beginPath();
    ctx.moveTo(ax - 7, ay - 44);
    ctx.lineTo(ax + 7, ay - 44);
    ctx.lineTo(ax, ay - 33);
    ctx.closePath();
    ctx.fillStyle = tintOf(p, g.state.party.members.indexOf(p));
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 7, 5, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* the name of what the cursor rests on, above everything */
  if (hovered) {
    const label = hoverLabel(g, hovered.x, hovered.y);
    if (label) {
      const hc = isoToScreen(hovered.x, hovered.y);
      ctx.font = '13px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const wLabel = ctx.measureText(label).width + 8;
      const lh = 18;
      let lx = hc.sx - isoCamX + ISO.TW / 2 + 4;
      let ly = hc.sy - isoCamY - ISO.TH - lh / 2;
      if (lx + wLabel > cw) lx = hc.sx - isoCamX - ISO.TW / 2 - wLabel - 4;
      if (ly < 0) ly = hc.sy - isoCamY + ISO.TH / 2 + 2;
      ctx.fillStyle = 'rgba(5, 7, 5, 0.85)';
      ctx.fillRect(lx, ly, wLabel, lh);
      ctx.strokeStyle = 'rgba(230, 220, 160, 0.4)';
      ctx.strokeRect(lx + 0.5, ly + 0.5, wLabel - 1, lh - 1);
      ctx.fillStyle = hostileHover ? '#e0aa60' : '#cfe0c0';
      ctx.fillText(label, lx + 4, ly + lh / 2 + 1);
    }
    ctx.textAlign = 'center';
  }

  /* Stairs are destinations: their mark rides above everything, so no
   * masonry, however tall, can lose them. */
  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of seenTiles) {
    const tile = floor.tiles[t.y][t.x];
    if (tile !== T.UP && tile !== T.DOWN) continue;
    /* This marker is the one thing a chart SHOULD carry over — where the
     * stairs are is most of why anyone reads one — so it stays, in the
     * chart's own ink until somebody has actually stood on it. */
    const known = !hearsay(t);
    const a = isoToScreen(t.x, t.y);
    const ax = a.sx - isoCamX, ay = a.sy - isoCamY;
    ctx.beginPath();
    ctx.arc(ax, ay - 24, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 7, 5, 0.75)';
    ctx.fill();
    ctx.strokeStyle = known ? theme.accent : CHART_INK;
    ctx.stroke();
    ctx.fillStyle = known ? theme.accent : CHART_INK;
    ctx.fillText(tile === T.DOWN ? '>' : '<', ax, ay - 23);
    /* A town mouth wears its NAME, always — a second descent that opened
     * five tiles south of the first went unfound behind a hover. */
    const mouthHere = floor.mouths && floor.mouths.find((mm) => mm.x === t.x && mm.y === t.y);
    if (mouthHere) {
      ctx.font = '12px "Courier New", monospace';
      ctx.textAlign = 'left';
      const wl = ctx.measureText(mouthHere.name).width + 8;
      ctx.fillStyle = 'rgba(5, 7, 5, 0.8)';
      ctx.fillRect(ax + 15, ay - 41, wl, 17);
      ctx.strokeStyle = 'rgba(230, 220, 160, 0.35)';
      ctx.strokeRect(ax + 15.5, ay - 40.5, wl - 1, 16);
      ctx.fillStyle = theme.accent;
      ctx.fillText(mouthHere.name, ax + 19, ay - 32);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Courier New", monospace';
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  /* The nameplates carry health bars now, and blood is drawn on every kind
   * of turn — the strip repaints with the HUD, not only with the sheets. */
  renderPartyStrip(g);
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
  const slot = g.state.party.members.indexOf(p);
  els.topstatus.innerHTML = '<b style="color:' + tintOf(p, slot) + '">' + esc(p.name) + '</b> · Lv ' + p.level +
    ' · ' + p.hp + '/' + p.maxhp + ' hp' +
    (p.wounds > 0 ? ' (' + p.wounds + ' wounded)' : '') +
    ' · ' + p.power + '/' + p.maxpower + ' pwr · ' + g.purse() + ' gp';
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

/* The company strip: click a chip to pin whose sheets you are looking at.
 * Rendered empty for a party of one — a strip of yourself is clutter. */
/* WHAT IS STANDING ON A MEMBER, in the width of a nameplate.
 *
 * The strip carried blood and power and nothing else, which was survivable
 * while every boon in the game was worn by whoever cast it — you knew, you
 * had just cast it. A ward thrown over the whole company broke that: the
 * playtest watched a priest take a blow and had no way to tell whether the
 * ward had reached them, because nothing anywhere said who was carrying one.
 *
 * Short forms because a nameplate is narrow, and ONE number on each, always
 * turns left — a boon with one turn on it is a different decision from one
 * with five, and it is the only figure that changes while you watch. The
 * magnitude is fixed at the moment of casting and lives in the tooltip and
 * the log; printing both put "WRD 5 4" on a plate an inch wide, which is a
 * riddle rather than a readout. `turn` is deliberately absent: it counts how
 * long the unhallowed keep running, a fact about the floor and not about
 * the person wearing it. */
const BOONS = {
  ward: { tag: 'WRD', label: 'Ward', amount: true, why: 'turned aside from every blow' },
  might: { tag: 'MGT', label: 'Might', amount: true, why: 'to hit' },
  shadow: { tag: 'HID', label: 'Hidden', why: 'nothing hunts what it cannot see' },
  sanctuary: { tag: 'SNC', label: 'Sanctuary', why: 'the dark forgets your name' },
  str: { tag: 'STR', label: 'Borrowed might', why: 'strength not your own' },
};

function boonChips(m) {
  const buffs = m.buffs || {};
  const out = [];
  for (const key of Object.keys(BOONS)) {
    const turns = buffs[key] || 0;
    if (turns <= 0) continue;
    const b = BOONS[key];
    const mag = b.amount ? ((m.buffLevels && m.buffLevels[key]) || 0) : 0;
    const title = b.label + (mag ? ': ' + mag + ' ' + b.why : ' — ' + b.why) +
      ', ' + turns + (turns === 1 ? ' turn left' : ' turns left');
    out.push('<i class="boon" title="' + esc(title) + '">' + b.tag + ' <b>' + turns + '</b></i>');
  }
  return out.length ? '<span class="boons">' + out.join('') + '</span>' : '';
}

function renderPartyStrip(g) {
  const members = g.state.party.members.filter(Boolean);
  if (members.length <= 1) { els.partyStrip.innerHTML = ''; return; }
  const shown = viewedMember(g);
  els.partyStrip.innerHTML = g.state.party.members.map((m, i) => {
    if (!m) return '';
    const tint = tintOf(m, i);
    const reins = m === g.state.player ? ' ●' : '';
    /* The nameplate carries the health: the same red bar as the HUD, in
     * miniature, so the whole company's blood is one glance up. */
    const hp = Math.max(0, Math.min(100, 100 * m.hp / Math.max(1, m.maxhp)));
    /* Power beside blood: a cleric with a full bar and no power is as
     * unable to help as one at death's door, and the strip was only
     * telling half of that. */
    const pwr = Math.max(0, Math.min(100, 100 * (m.power || 0) / Math.max(1, m.maxpower || 1)));
    return '<button draggable="true" data-view="' + i + '" style="color:' + tint + '" class="' +
      (m === shown ? 'viewed' : '') + (m === g.state.player ? ' reins' : '') + (m.hp <= 0 ? ' fallen' : '') + '">' +
      '<span class="pchip-row"><img class="portrait-xs" src="' + memberPortrait(m.name, heroSex(m)) + '" alt="">' +
      esc(m.name) + reins + '</span>' +
      '<span class="pbar"><i style="width:' + hp + '%"></i></span>' +
      '<span class="pbar pwr"><i style="width:' + pwr + '%"></i></span>' +
      boonChips(m) + '</button>';
  }).join('');
}

function renderStats(g) {
  renderPartyStrip(g);
  const p = viewedMember(g);
  if (!p) { els.statBlock.innerHTML = ''; els.abilitiesBlock.innerHTML = ''; return; }
  const c = CLASSES[p.cls] || CLASSES.fighter;
  const der = g.derived(p);
  const eff = der.effValues || p.stats;
  const toNext = Math.max(0, XP_FOR_LEVEL(p.level) - p.xp);
  const KEY = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
  let rows = '';
  const kv = (k, v) => rows += '<tr><td class="k">' + k + '</td><td class="v">' + v + '</td></tr>';
  kv('Name', esc(p.name));
  kv('Class', c.name + ' (' + c.glyph + ')');
  const bg = backgroundById(p.background);
  if (bg) kv('Background', esc(bg.name));
  kv('Level', p.level);
  /* The marching order: who walks ahead of the reins between fights, and
   * who behind. Class sets it — steel forward, robes back — one click
   * swaps it, and it is saved with the member. */
  kv('Marches', '<button class="mini" data-stance title="Out of combat: the van walks ahead of whoever holds the reins, the rear behind.">' +
    (g.memberStance(p) === 'van' ? 'IN THE VAN' : 'IN THE REAR') + '</button>');
  kv('XP', p.xp + ' / next ' + toNext);
  kv('Gold', g.purse() + ' gp <span class="tiny">company</span>');
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
  els.statBlock.innerHTML =
    '<div class="sheet-head"><img class="portrait-sm" src="' + memberPortrait(p.name, heroSex(p)) + '" alt="">' +
    '<div><b>' + esc(p.name) + '</b><div class="tiny">' + c.name +
    (bg ? ' · ' + esc(bg.name) : '') + ' · level ' + p.level + '</div></div></div>' +
    '<table class="stats">' + rows + '</table>' +
    '<h3 class="pane">ATTRIBUTES</h3><table class="stats">' +
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) =>
      '<tr><td class="k">' + KEY[k] + '</td><td class="v">' + eff[k] + ' <span style="color:var(--amb-dim)">' +
      (abilityMod(eff[k]) >= 0 ? '+' : '') + abilityMod(eff[k]) + '</span></td></tr>').join('') +
    '</table>';
  /* THE SKILLS: what a level teaches outside of fighting. The [+] spends
   * the viewed member's own unspent learning — theirs, not the leader's. */
  const pts = p.skillPoints || 0;
  els.statBlock.innerHTML += '<h3 class="pane">SKILLS' +
    (pts > 0 ? ' <span class="tiny">' + pts + ' unspent</span>' : '') + '</h3>' +
    '<table class="stats">' + SKILLS.map((s) => {
      const rank = (p.skills && p.skills[s.id]) || 0;
      const pips = '&#9679;'.repeat(rank) + '<span style="color:var(--ink-faint)">' + '&#9675;'.repeat(s.max - rank) + '</span>';
      const plus = pts > 0 && rank < s.max ? ' <button class="mini" data-skill="' + s.id + '">+</button>' : '';
      return '<tr title="' + esc(s.desc) + '"><td class="k">' + esc(s.name) + '</td><td class="v">' + pips + plus + '</td></tr>';
    }).join('') + '</table>';
  const buffs = buffLines(p);
  if (buffs.length) {
    els.statBlock.innerHTML += '<h3 class="pane">EFFECTS</h3>' + buffs.map((b) => '<div class="ability-card">' + b + '</div>').join('');
  }
  /* Handlers attach after the LAST innerHTML write — every += above this
   * line rebuilds the DOM and silently orphans anything bound earlier. */
  els.statBlock.querySelectorAll('[data-skill]').forEach((b) => {
    b.onclick = () => {
      if (!game) return;
      game.spendSkillPoint(p, b.dataset.skill);
      renderStats(game);
      saveGame();
    };
  });
  const stanceBtn = els.statBlock.querySelector('[data-stance]');
  if (stanceBtn) {
    stanceBtn.onclick = () => {
      if (!game) return;
      p.stance = game.memberStance(p) === 'van' ? 'rear' : 'van';
      game.log(p.name + ' will march ' + (p.stance === 'van' ? 'in the van, ahead of the reins.' : 'in the rear, behind the steel.'));
      renderStats(game);
      saveGame();
    };
  }
  const own = p === g.state.player;
  /* A companion's powers are reachable between fights — the standing cast:
   * click (or the digits, while their sheet is up) and the company holds
   * still while they work it. Mid-fight the initiative order decides. */
  const calm = g.outOfCombat();
  const usable = own || calm;
  els.abilitiesBlock.innerHTML = '<h3 class="pane">POWERS' + (own
    ? ' (keys 1-' + g.allAbilities(p).length + ')'
    : ' <span class="tiny">' + esc(p.name) + '\u2019s — ' + (calm ? 'usable while the halls are calm' : 'usable on their turn') + '</span>') + '</h3>';
  g.allAbilities(p).forEach((a, i) => {
    const cd = p.cooldowns[a.id] || 0;
    const can = p.level >= a.level && (a.kind === 'passive' || p.power >= (a.powerCost || 0)) && cd === 0;
    const el = document.createElement('div');
    el.className = 'ability-card' + (cd > 0 ? '' : '');
    /* A healing power beats its own die roll when you are big enough, so the
     * floor is appended rather than trusted to the description — which covers
     * the ones the Library writes as well as the four that shipped. */
    const heals = abilityHealNote(a, { maxhp: p.maxhp });
    const renews = abilityPowerNote(a, { maxpower: p.maxpower });
    /* The range this character will actually roll, so no card has to be
     * taken on faith about what "+INT" means. */
    const effV = der.effValues || p.stats;
    const hits = abilityDamageNote(a, {
      intMod: abilityMod(effV.int), strMod: abilityMod(effV.str),
      practice: Math.floor((p.level - 1) / 3), level: p.level,
    });
    /* THE REACH BOX. Only on workings that reach across ground — a passive
     * or a mantle worn on yourself has no boundary to draw, and an empty
     * checkbox beside one is a promise the map cannot keep. The swatch is
     * the colour its ring will be, so two ticked at once can be told apart
     * on the floor without counting tiles. */
    const reach = abilityReach(a);
    const box = reach
      ? '<span class="reach" title="Show this working\u2019s reach on the ground">' +
        '<input type="checkbox" data-ring="' + esc(a.id) + '"' + (rangeRings.has(a.id) ? ' checked' : '') + '>' +
        '<i class="swatch" style="background:' + ringColour(a.id) + '"></i></span>'
      : '';
    el.innerHTML = box + '<b>[' + (i + 1) + '] ' + esc(a.name) + '</b>' +
      (a.kind === 'passive' ? ' <span class="tiny">passive</span>'
        /* "0 pwr" reads as broken. A working that costs nothing is at will. */
        : ' <span class="tiny">' + (a.powerCost ? a.powerCost + ' pwr' : 'at will') +
          (a.cooldown ? ' · cd ' + a.cooldown : '') + '</span>') +
      (a.level > 1 ? ' <span class="tiny">Lv' + a.level + '</span>' : '') +
      (cd > 0 ? ' <b style="color:var(--red-dim)">(' + cd + ')</b>' : '') +
      '<div class="desc">' + esc(a.description || '') +
      (hits ? ' <span class="tiny">(' + esc(hits) + ')</span>' : '') +
      (heals ? ' <span class="tiny">(' + esc(heals) + ')</span>' : '') +
      (renews ? ' <span class="tiny">(' + esc(renews) + ')</span>' : '') + '</div>';
    if ((!can || !usable) && a.kind !== 'passive') el.style.opacity = 0.55;
    /* The box lives inside the card, and the card fires the working when
     * clicked. Ticking a box must not also cast the spell. */
    const tick = el.querySelector('.reach');
    if (tick) {
      tick.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const input = tick.querySelector('input');
        if (ev.target !== input) return;
        if (input.checked) rangeRings.add(a.id); else rangeRings.delete(a.id);
        saveRings();
        lastTiles = '';
        if (game) renderGame(game);
      });
    }
    el.onclick = () => {
      if (!game || game.dying || a.kind === 'passive') return;
      if (own) game.activateAbility(a.id);
      else game.castAs(p, a.id);   /* the standing cast — refused with a line mid-fight */
      renderStats(game);
      saveGame();
      canvasFocus();
    };
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

/* What the button will actually do, so the label cannot lie — which it did,
 * for as long as this asked isWorn's question and the click asked a different
 * one. Both ask it here now. */
function itemVerb(it) {
  if (!it) return 'USE';
  if (it.kind === 'wand') return 'FIRE';
  return isWorn(it) ? 'WEAR' : 'USE';
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
  renderPartyStrip(g);
  const p = viewedMember(g);
  if (!p) return;
  const own = p === g.state.player;
  const others = g.state.party.members.filter((m) => m && m !== p && m.hp > 0);
  const SLOTS = [['weapon', 'WEAPON'], ['body', 'BODY'], ['shield', 'SHIELD'], ['ring', 'RING'], ['amulet', 'AMULET']];
  let html = '';
  for (const [slot, label] of SLOTS) {
    const it = p.equipment[slot];
    /* Red means a KNOWN curse. An unread enchantment — blessing or trap —
     * shows the same magic blue, which is the whole lure. */
    const known = !it || it.identified !== false;
    const cursedShow = it && it.cursed && known;
    const mag = it && !cursedShow && (it.identified === false || it.magicLevel > 0);
    html += '<div class="eq-row"><span class="slot">' + label + '</span>' +
      '<span class="ico">' + (it ? itemIcon(it) : '·') + '</span>' +
      '<span class="i-name' + (cursedShow ? ' cursed' : mag ? ' mag' : '') + '"' + flavorTitle(it) + '>' +
      (it ? esc(it.name) : '—') + '</span>' +
      (it ? '<button data-act="unequip" data-slot="' + slot + '">TAKE OFF</button>' : '') +
      '</div>' + descRow(it, p);
  }
  /* WHOSE. A panel that says only "PACK" is read as "the party's pack",
   * and a thing handed to a companion then looks lost. Every heading on
   * this tab names the character it belongs to. */
  const whose = esc(p.name) + '\u2019s ';
  els.equipmentBlock.innerHTML = '<h3 class="pane">' + whose.toUpperCase() + 'GEAR</h3>' + html;

  const inv = p.inventory || [];
  const onBelt = (it) => (p.belt || []).some((e) => e && (typeof e === 'string' ? e : e.uid) === it.uid);
  const ih = stackInventory(inv).map((grp) => {
    const it = grp.item;
    /* Bind and drop act on a copy that is not already on the belt, so a stack
     * of three potions can put one in a loop and keep two in the pack. */
    const free = grp.indices.find((i) => !onBelt(inv[i]));
    const cursedShow = it.cursed && it.identified !== false;
    const magShow = !cursedShow && (it.identified === false || it.magicLevel > 0);
    /* Mid-hand-over this row shows the recipients instead of its verbs. */
    const giveIdx = free === undefined ? grp.indices[0] : free;
    const handing = givingUid && inv[giveIdx] && inv[giveIdx].uid === givingUid;
    const verbs = handing
      ? others.map((m) => '<button data-give-to="' + g.state.party.members.indexOf(m) + '" data-give="' + giveIdx + '" style="color:' + tintOf(m, g.state.party.members.indexOf(m)) + '">&rarr; ' + esc(m.name) + '</button>').join('') +
        '<button data-give-cancel="1">&times;</button>'
      : (it.slot === 'consumable' || it.kind === 'wand'
          ? '<button data-inv="' + grp.indices[0] + '"' + (own || g.outOfCombat() ? '' : ' disabled title="on their turn"') + '>' + itemVerb(it) + '</button>'
          : '<button data-inv="' + grp.indices[0] + '">' + itemVerb(it) + '</button>') +
        (it.kind === 'wand' && WEARABLE.includes(it.slot)
          ? '<button data-wield="' + grp.indices[0] + '">WIELD</button>' : '') +
        (free === undefined ? '' : '<button data-bind="' + free + '">BELT</button>') +
        (others.length ? '<button data-give-start="' + giveIdx + '">GIVE</button>' : '') +
        '<button data-drop="' + giveIdx + '">DROP</button>';
    return '<div class="eq-row"><span class="ico">' + itemIcon(it) + '</span>' +
      '<span class="i-name' + (cursedShow ? ' cursed' : magShow ? ' mag' : '') + '"' + flavorTitle(it) + '>' + esc(it.name) +
      (grp.indices.length > 1 ? ' <b class="qty">&times;' + grp.indices.length + '</b>' : '') + '</span>' +
      verbs + '</div>' +
      descRow(it, p);
  }).join('');
  els.inventoryBlock.innerHTML = '<h3 class="pane">' + whose.toUpperCase() + 'PACK (' + inv.length + '/' + PACK_LIMIT + ')</h3>' +
    (ih || '<div class="tiny">You carry nothing.</div>');

  let belt = '';
  const b = p.belt || [null, null, null, null];
  for (let i = 0; i < b.length; i++) {
    const it = g.beltItem(i, p);
    belt += '<div class="eq-row"><span class="slot">⇧' + (i + 1) + '</span>' +
      '<span class="ico">' + (it ? itemIcon(it) : '·') + '</span>' +
      '<span class="i-name">' + (it ? esc(it.name) : '—') + '</span>' +
      (it ? '<button data-use-belt="' + i + '"' + (own || g.outOfCombat() ? '' : ' disabled title="on their turn"') + '>USE</button><button data-belt="' + i + '">UNBIND</button>' : '') + '</div>';
  }
  els.beltBlock.innerHTML = '<h3 class="pane">' + whose.toUpperCase() + 'BELT <span class="tiny">shift + 1-4</span></h3>' + belt;
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

  /* THE POWERS, and where you stand with them. The notes were always here;
   * what was missing was any sign that the seven orders had noticed you.
   * An order you have done right by says what that has bought — because a
   * standing you cannot feel is a number, and this game has enough of
   * those. */
  const FAVOURS = {
    'carriers-ubtao': 'The four families pay above scrap for everything you haul up.',
    'drowned-sisters': 'The Sisters have named you the safe channels: black water no longer costs you the ground.',
    'keepers-coils': 'Venn keeps the survey open to you: hidden seams give themselves up sooner.',
  };
  const cleared = g.baseDungeonIds().filter((id) => g.isDungeonCleared(id)).length;
  const anyStanding = WORLD.factions.some((f) => g.standing(f.id) > 0);
  let powers = '';
  if (!cleared && !anyStanding) {
    powers = '<div class="tiny">You have not yet come to anyone\'s attention. Give it time.</div>';
  } else {
    powers = WORLD.factions.map((f) => {
      const n = g.standing(f.id);
      const rank = g.standingRank(f.id);
      const favour = n > 0 ? FAVOURS[f.id] : '';
      return '<div class="codex-item' + (n > 0 ? '' : ' unread') + '"><b>' + esc(f.name) + '</b> ' +
        '<span class="tiny">· ' + esc(f.stance) + '</span>' +
        '<div class="tiny">They count you <b>' + esc(rank) + '</b>' +
        (n > 0 ? ' <span class="qty">&times;' + n + '</span>' : '') + '</div>' +
        (favour ? '<p class="flavor" style="color:var(--grn)">' + esc(favour) + '</p>' : '') +
        '<p class="flavor">' + esc(f.note) + '</p></div>';
    }).join('');
  }

  const met = WORLD.npcs.filter((n) => p.npcsMet && p.npcsMet[n.id]);
  const cast = met.length
    ? met.map((n) => '<div class="codex-item"><b>' + esc(n.name) + '</b> <span class="tiny">· ' + esc(n.title) + '</span></div>').join('')
    : '<div class="tiny">You have spoken to no one down there. Walk into someone.</div>';

  /* THE JOURNAL: newest ink first, the campfire version of the run. */
  const jn = (g.state.journal || []).slice(-40).reverse().map((e) =>
    '<div class="codex-item"><span class="tiny">' + esc(e.where || '—') + ' · turn ' + (e.turn || 0) + '</span>' +
    '<p class="flavor">' + esc(e.text) + '</p></div>').join('')
    || '<div class="tiny">Nothing worth ink yet. It will come.</div>';

  /* THE UNDERTAKINGS: what has been taken on, what is still wanted, and
   * who is owed the telling. Above the journal, because it is the only
   * part of the codex that asks something of the player. */
  const und = [];
  for (const q of g.activeQuests()) {
    const giver = WORLD.npcs.find((n) => n.id === q.giver);
    const ready = g.questSatisfied(q);
    und.push('<div class="codex-item' + (ready ? '' : ' unread') + '"><b>' + esc(q.name) + '</b> ' +
      '<span class="tiny">· ' + esc(objectiveText(q, g.questProgressOf(q))) +
      (ready && giver ? ' · take it back to ' + esc(giver.name) : '') + '</span>' +
      '<p class="flavor">' + esc(q.accepted || '') + '</p></div>');
  }
  const closed = QUESTS.filter((q) => g.questState(q.id) === 'done');
  for (const q of closed) {
    und.push('<div class="codex-item"><b>' + esc(q.name) + '</b> <span class="tiny">· seen through</span></div>');
  }
  const undertakings = und.join('') ||
    '<div class="tiny">Nobody has asked anything of you yet. People who want things are found by talking to them.</div>';

  els.dungeonCodex.innerHTML =
    codexSection('THE UNDERTAKINGS', undertakings) +
    codexSection('THE JOURNAL', jn) +
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
  /* THE SIGNPOST. "No oracle is bound" was true, and useless: it named a
   * problem beside a button whose label ("OPEN THE BLACK LIBRARY") reads as
   * flavour rather than as the place the problem gets solved. Somebody who
   * wants to choose a model has no reason to think that door is the one.
   *
   * So the state says what to do, and the button says what it does. When an
   * oracle IS bound it says which one, because the other question this panel
   * never answered is "am I about to spend somebody's tokens, and whose". */
  const bound = oracle && oracle.ready;
  const who = bound
    ? [oracle.provider, oracle.model].filter(Boolean).join(' · ')
    : '';
  els.libraryBlock.innerHTML =
    '<h3 class="pane">THE BLACK LIBRARY</h3>' +
    '<div class="lib-status">Base chronicle: ' + cleared + '/3 sanctums conquered. ' +
    (scrambled ? scrambled : 'Press the sigil below to petition the oracle.') +
    '</div>' +
    (bound
      ? '<div class="lib-status">Bound to <b>' + esc(who) + '</b>.</div>'
      : '<div class="lib-status"><b>No oracle is bound.</b> Choose which model writes the depths — ' +
        'a hosted one, or a machine on your own network.</div>') +
    '<div class="row"><button id="btn-open-library">' +
    (bound ? 'OPEN THE BLACK LIBRARY' : 'CHOOSE A MODEL &rarr;') + '</button></div>';
  const b = els.libraryBlock.querySelector('#btn-open-library');
  if (b) b.onclick = () => openLibrary(!bound);
}

/* ---------------- keyboard & actions ---------------- */
function canvasFocus() { els.canvas.focus(); }

function onKey(e) {
  /* The keyboard outranks the autopilot: any key stops the walk. */
  if (walkPath || walkDest) cancelWalk();
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
    const beltWho = viewedMember(game);
    if (beltWho && beltWho !== game.state.player) game.useBeltItemAs(beltWho, Number(e.code.slice(5)) - 1);
    else game.handleKey(null, { belt: Number(e.code.slice(5)) - 1 });
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
    /* The digits fire the powers of whoever the SHEET shows — the numbers
     * on screen are the numbers that fire. For the member at the reins that
     * is the classic path; for a companion, between fights, it is the
     * standing cast. Mid-fight a pinned companion sheet refuses rather than
     * blowing the wrong ability: this is exactly how a backstab got spent
     * by someone aiming a fireball. */
    const shown = viewedMember(game);
    if (shown && shown !== game.state.player) {
      if (!game.outOfCombat()) {
        game.log('It is ' + game.state.player.name + '’s turn — the sheet is open on ' + shown.name + '. Click a chip to follow the round.');
        e.preventDefault();
        return;
      }
      const abTheirs = game.allAbilities(shown);
      const their = abTheirs[Number(k) - 1];
      if (their && their.kind !== 'passive') {
        game.castAs(shown, their.id);
        renderStats(game);
        if (currentTab === 'gear') renderGear(game);
        saveGame();
        e.preventDefault();
      }
      return;
    }
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
  if ((k === '+' || k === '=' || k === '-') && viewMode === 'iso' && !cardUp) {
    /* Proportional, like the wheel: a flat step of 0.15 is a third of the
     * way in at the near end and a twentieth at the far end, so the keys
     * felt broken at exactly the range this ceiling opened up. */
    setIsoZoom(k === '-' ? isoZoom / 1.15 : isoZoom * 1.15);
    e.preventDefault();
    return;
  }
  if (k === 'g' && !cardUp && game) {
    /* Loot lands in the pack of the character whose sheet is in focus.
     * Both panels repaint whichever tab is up: a scroll that is really in
     * a pack but absent from the open panel is indistinguishable from one
     * that was never taken, and that mystery has now cost two reports. */
    game.handleKey('g', { lootTo: viewedIdx === null ? undefined : viewedIdx });
    renderGear(game);
    renderStats(game);
    saveGame();
    e.preventDefault();
    return;
  }
  if (k === 't' && viewMode === 'iso' && !cardUp) {
    wallMode = wallMode === 'down' ? 'up' : 'down';
    try { localStorage.setItem('lapsai-walls', wallMode); } catch { /* private mode */ }
    if (game) {
      game.log(wallMode === 'down' ? 'The walls kneel: every stone cut to a stub.' : 'The walls stand at their height again.');
      lastTiles = '';
      renderGame(game);
    }
    e.preventDefault();
    return;
  }
  if (k === 'v') {
    viewMode = viewMode === 'iso' ? 'classic' : 'iso';
    try { localStorage.setItem('lapsai-view', viewMode); } catch { /* private mode */ }
    lastTiles = '';
    if (game) renderGame(game);
    e.preventDefault();
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
  /* The town's keepers are counters, not conversationalists: walking into
   * one opens their trade, the same functions the camp card used to hold. */
  if (tpl && tpl.service && game) {
    if (tpl.service === 'shop') showShop(game);
    else if (tpl.service === 'sage') showSage(game);
    else if (tpl.service === 'muster') showMuster(game);
    else if (tpl.service === 'inn') showInn(game);
    else if (tpl.service === 'temple') showTemple(game);
    return;
  }
  if (game && tpl && tpl.id) game.introduceNpc(tpl.id);
  activeNpc = tpl;
  dialogueOpen = true;
  els.dlgName.innerHTML = '<img class="portrait-sm" src="' + npcPortrait(tpl.id || tpl.name, tpl.sex) + '" alt=""> ' +
    esc(tpl.name) + ' — ' + esc(tpl.title || 'a denizen of the dark');
  els.dlgLog.innerHTML = '';
  const hist = dialogue.start(tpl);
  for (const m of hist) appendDlg(m);
  els.dlgInput.value = '';
  renderQuestOffers();
  overlayShow(els.dialogue);
  setTimeout(() => els.dlgInput.focus(), 30);
}

/* WHAT THIS PERSON WANTS OF YOU. Offers and payments ride above the input
 * box, so a quest is taken and closed in the same conversation it is
 * spoken of rather than through a menu somewhere else. */
function renderQuestOffers() {
  const host = els.dlgQuests;
  if (!host) return;
  host.innerHTML = '';
  if (!game || !activeNpc || !activeNpc.id) return;
  const owed = game.questsToClose(activeNpc.id);
  const offers = game.questsOnOffer(activeNpc.id);
  let html = '';
  for (const q of owed) {
    html += '<div class="quest-offer done"><b>' + esc(q.name) + '</b>' +
      '<p class="flavor">' + esc(q.done || '') + '</p>' +
      '<button data-quest-done="' + esc(q.id) + '">HAND IT OVER</button></div>';
  }
  for (const q of offers) {
    html += '<div class="quest-offer"><b>' + esc(q.name) + '</b>' +
      '<p class="flavor">' + esc(q.offer || '') + '</p>' +
      '<button data-quest-take="' + esc(q.id) + '">TAKE IT ON</button></div>';
  }
  host.innerHTML = html;
  host.querySelectorAll('[data-quest-take]').forEach((b) => {
    b.onclick = () => {
      const q = game.questsOnOffer(activeNpc.id).find((x) => x.id === b.dataset.questTake);
      if (game.acceptQuest(b.dataset.questTake) && q && q.accepted) appendDlg({ role: 'npc', text: q.accepted });
      renderQuestOffers(); renderCodex(game); saveGame();
    };
  });
  host.querySelectorAll('[data-quest-done]').forEach((b) => {
    b.onclick = () => {
      const q = game.questsToClose(activeNpc.id).find((x) => x.id === b.dataset.questDone);
      if (game.completeQuest(b.dataset.questDone) && q && q.done) appendDlg({ role: 'npc', text: q.done });
      renderQuestOffers(); renderCodex(game); renderStats(game); renderGear(game); renderHud(game); saveGame();
    };
  });
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

function openLibrary(openTheOracle) {
  els.libResult.innerHTML = '';
  els.libActions.innerHTML = EXP_ACTIONS.map(([a, label]) =>
    '<button data-act="' + a + '">' + label + '</button>').join('');
  paintOracle();
  overlayShow(els.libOverlay);
  /* Arriving with nothing bound, the fold opens itself: the settings ARE the
   * errand, and a collapsed <details> is one more thing to find. */
  if (openTheOracle && els.oraclePanel) els.oraclePanel.open = true;
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
  els.libSource.disabled = !on;
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

/* ASK THE ENDPOINT WHAT IT SERVES.
 *
 * Binding a hosted provider is a menu choice. Binding a box on your own
 * network is not: nobody remembers the exact id a local server files a model
 * under, and one character wrong reads as a dead endpoint rather than as a
 * typo. So type the host, press this, and pick the model off the machine's
 * own list — the answers land in the MODEL field's suggestions, and if there
 * is only one it is filled in for you.
 *
 * Sent from the form rather than from what is bound, so it works BEFORE you
 * commit to anything. It costs no tokens; it is a listing, not a call. */
async function askWhatItServes() {
  note('asking the endpoint…', '');
  try {
    const data = await postOracle('/api/oracle/models', {
      provider: els.oracleProvider.value,
      model: els.oracleModel.value.trim(),
      baseUrl: els.oracleBase.value.trim(),
      apiKey: els.oracleKey.value,
    });
    if (!data.ok) { note(data.error || 'the endpoint did not answer', 'bad'); return; }
    const models = data.models || [];
    els.oracleModels.innerHTML = models.map((m) =>
      '<option value="' + esc(m) + '"></option>').join('');
    /* A machine serving exactly one model does not need you to choose. */
    if (models.length === 1) els.oracleModel.value = models[0];
    else if (!models.includes(els.oracleModel.value.trim())) els.oracleModel.value = '';
    note(models.length === 1
      ? 'It serves ' + models[0] + ' — filled in for you.'
      : 'It serves ' + models.length + ' models: open the MODEL field and pick one.', 'good');
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
  const source = (els.libSource.value || '').trim();
  try {
    const p = game && game.state.player;
    const bodyContext = { focus };
    if (source) bodyContext.source = source;
    /* THE WORLD IT IS WRITING INTO. Built from the lore itself rather than
     * from a copy of it, so a briefing cannot go stale when the writing
     * grows — and sent every time, because the register is the part a model
     * gets wrong first. */
    /* A written sanctum may not be gentler than the last thing the company
     * cleared — the model does not know what that was, so the floor is sent
     * rather than asked for. */
    if (game) {
      const cleared = game.availableDungeons().filter((d) => d && game.isDungeonCleared(d.id));
      bodyContext.minThreat = cleared.reduce((n, d) => Math.max(n, (d.threat || 0) + 2), 0);
    }
    bodyContext.lore = loreBriefing({
      dungeons: game ? game.availableDungeons().map((x) => x && x.name).filter(Boolean) : [],
    });
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
  /* DRAGGING A NAMEPLATE REORDERS THE COMPANY. The roster decides who
   * stands where on arrival and who inherits the reins, so the player
   * gets to say what it is: pick a plate up, drop it on another, and the
   * two trade places in the line. */
  let dragFrom = null;
  els.partyStrip.addEventListener('dragstart', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    dragFrom = Number(b.dataset.view);
    b.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch { /* some browsers refuse */ } }
  });
  els.partyStrip.addEventListener('dragend', () => {
    dragFrom = null;
    els.partyStrip.querySelectorAll('.dragging, .drop-target')
      .forEach((el) => el.classList.remove('dragging', 'drop-target'));
  });
  els.partyStrip.addEventListener('dragover', (e) => {
    const b = e.target.closest('[data-view]');
    if (dragFrom === null || !b) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    els.partyStrip.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    if (Number(b.dataset.view) !== dragFrom) b.classList.add('drop-target');
  });
  els.partyStrip.addEventListener('drop', (e) => {
    const b = e.target.closest('[data-view]');
    if (dragFrom === null || !b || !game) return;
    e.preventDefault();
    const to = Number(b.dataset.view);
    if (game.reorderParty(dragFrom, to)) {
      const order = game.state.party.members.filter(Boolean).map((m) => m.name).join(', ');
      game.log('The company falls in: ' + order + '.');
      /* A pinned view follows its character through the shuffle. */
      viewedIdx = null;
      renderStats(game); renderGear(game); renderHud(game); renderGame(game); saveGame();
    }
    dragFrom = null;
  });

  els.partyStrip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || !game) return;
    const i = Number(b.dataset.view);
    const m = game.state.party.members[i];
    /* Between fights, focusing a member HANDS THEM THE REINS — you steer
     * who you are looking at, which is what "I put the focus on the
     * fighter before moving" was always meant to do. Mid-fight the round
     * decides who acts, and a chip click only picks whose sheet shows. */
    if (m && m.hp > 0 && m !== game.state.player && game.outOfCombat()) {
      game.state.party.active = i;
      viewedIdx = null;   /* the sheets follow the reins */
      game.log(m.name + ' takes the reins.');
      game.computeVisibility();
      renderGame(game); renderHud(game);
    } else {
      viewedIdx = m === game.state.player ? null : i;
    }
    givingUid = null;
    renderStats(game); renderGear(game);
  });
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
  els.btnOracleModels.onclick = () => askWhatItServes();
  els.btnOracleForget.onclick = () => forgetOracle();

  document.querySelectorAll('#sheets-tabs .tab').forEach((t) => {
    t.onclick = () => setTab(t.dataset.tab);
  });

  els.equipmentBlock.addEventListener('click', equipmentClick);
  els.inventoryBlock.addEventListener('click', inventoryClick);
  els.inventoryBlock.addEventListener('contextmenu', (e) => { inventDrop(e); e.preventDefault(); });
  els.beltBlock.addEventListener('click', beltClick);

  window.addEventListener('resize', () => { fitCanvas(); if (game) renderGame(game); });
  els.canvas.addEventListener('click', onCanvasClick);
  els.canvas.addEventListener('mousemove', onCanvasMove);
  els.canvas.addEventListener('mouseleave', onCanvasLeave);
  els.canvas.addEventListener('wheel', (e) => {
    if (viewMode !== 'iso') return;
    e.preventDefault();
    setIsoZoom(isoZoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });
  document.addEventListener('keydown', onKey);
  const anim = setInterval(() => { if (game && !document.hidden) renderGame(game); }, 200);
  document.addEventListener('keydown', (e) => { if (e.key === 'F5' || (e.key === 's' && (e.metaKey || e.ctrlKey))) saveGame(); });

  setBootNote();
  els.overlay.classList.remove('hidden');
  els.boot.classList.remove('hidden');
}

/* ---------------- gear click handlers ---------------- */
function equipmentClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || !game) return;
  if (b.dataset.act === 'unequip') { game.unequip(b.dataset.slot, viewedMember(game)); renderGear(game); renderStats(game); saveGame(); canvasFocus(); }
}

function inventoryClick(e) {
  const b = e.target.closest('button');
  if (!b || !game || b.disabled) return;
  const p = viewedMember(game);
  if (b.dataset.giveStart !== undefined) {
    const it = p.inventory[Number(b.dataset.giveStart)];
    givingUid = it && it.uid;
  } else if (b.dataset.giveCancel !== undefined) {
    givingUid = null;
  } else if (b.dataset.giveTo !== undefined) {
    const to = game.state.party.members[Number(b.dataset.giveTo)];
    game.giveItem(p.inventory[Number(b.dataset.give)], to, p);
    givingUid = null;
  } else if (b.dataset.drop !== undefined) {
    game.drop(p.inventory[Number(b.dataset.drop)], p);
  } else if (b.dataset.bind !== undefined) {
    game.bindToBelt(p.inventory[Number(b.dataset.bind)], p);
  } else if (b.dataset.inv !== undefined) {
    const it = p.inventory[Number(b.dataset.inv)];
    /* Wearing is arranging straps — free, anyone's. Drinking spends the
     * turn of whoever drinks: at the reins, the classic path; a companion
     * between fights, the standing swig (refused with a line mid-fight). */
    if (isWorn(it)) game.equip(it, p);
    else if (p !== game.state.player) game.useItemAs(p, it);
    else game.useItem(it);
  } else if (b.dataset.wield !== undefined) {
    /* A wand is the one thing worth both verbs: fire it for the working it
     * carries, or hold it, which lends its damage to the arm and — if it is
     * a focus — its power back to the reserve. One button could only ever
     * be a lie about the other. */
    game.equip(p.inventory[Number(b.dataset.wield)], p);
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
  game.drop(viewedMember(game).inventory[Number(b.dataset.inv)], viewedMember(game));
  renderGear(game); renderStats(game); saveGame();
}

function beltClick(e) {
  const use = e.target.closest('[data-use-belt]');
  if (use && game && !use.disabled) {
    const who = viewedMember(game);
    if (who !== game.state.player) game.useBeltItemAs(who, Number(use.dataset.useBelt));
    else game.useBeltItem(Number(use.dataset.useBelt));
    renderGear(game); renderStats(game); saveGame(); canvasFocus();
    return;
  }
  const b = e.target.closest('[data-belt]');
  if (!b || !game) return;
  game.setBelt(Number(b.dataset.belt), null, viewedMember(game));
  renderGear(game); saveGame(); canvasFocus();
}

boot();

