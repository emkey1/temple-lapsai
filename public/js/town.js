/* THE WHETSTONE: the town at the top of the stairs, and the answer to the
 * oldest open question in the playtest notes — "what is the purpose of gold,
 * other than as an excuse to resurrect the player?"
 *
 * Two establishments. The Provisioner buys what you haul up and sells the
 * consumables the dungeon is stingy with; the Lector reads runes and unbinds
 * curses, for coin, so a curse has a way out that does not depend on a lucky
 * scroll drop. Every price lives here in one table.
 *
 * DOM-free on purpose, like roster.js: every function takes the game, so the
 * whole economy runs headless in tests. The UI in main.js only renders what
 * these functions decide.
 */

import { getItemTemplate, CLASSES, BACKGROUNDS } from './base.js';
import { deepItem } from './dice.js';
import { PACK_LIMIT, makePlayer, initialStats } from './engine.js';

export const PRICES = {
  buyMarkup: 2,      /* the shop sells at twice an item's worth — it is a shop */
  sellShare: 0.4,    /* and buys at two-fifths, which is how shops go on existing */
  identify: 20,      /* the Lector reads one rune */
  unbind: 80,        /* or prises one curse loose — a Draught costs about this */
  hire: 60,          /* a sword-arm fresh off the road */
  hirePerLevel: 40,  /* and more for every level of seasoning they arrive with */
};

export const PARTY_LIMIT = 4;

/* What is on the shelf. It grows with the expedition's standing: the deeper
 * the world knows you have been, the better the Provisioner's suppliers. */
/* Haggle bends every counter in town: buying cheaper, selling dearer, the
 * Lector's fees trimmed — six percent a rank, from whoever in the company
 * haggles best, because the best mouth does the talking. */
export function haggleRank(game) {
  const members = game.livingMembers ? game.livingMembers() : [game.state.player];
  return Math.max(...members.map((m) => (m && m.skills && m.skills.haggle) || 0), 0);
}

function buyCut(game) { return 1 - 0.06 * haggleRank(game); }
function sellLift(game) { return 1 + 0.08 * haggleRank(game); }

export function shopStock(game) {
  const p = game.state.player;
  const slain = p ? Object.keys(p.bossesSlain || {}).filter((k) => p.bossesSlain[k]).length : 0;
  const ids = ['potion-heal', 'potion-power', 'scroll-identify', 'scroll-recall'];
  if (slain >= 1) ids.push('potion-major-heal', 'scroll-remove-curse');
  if (slain >= 2) ids.push('scroll-sanctuary', 'potion-remove-curse');
  /* The rack and the rail: plain arms and armour, always in stock — a
   * hireling arrives outfitted, but a blade breaks nothing loose in this
   * economy and a naked mage should not need boss-luck to buy a robe.
   * Better steel arrives as the expedition's standing grows. */
  ids.push('dagger', 'short-sword', 'mace', 'staff', 'broadsword', 'hand-axe',
    'padded-armor', 'leather-armor', 'studded-armor', 'small-shield');
  if (slain >= 1) ids.push('war-hammer', 'chainmail');
  if (slain >= 2) ids.push('battle-axe', 'scale-armor');
  return ids
    .map((id) => getItemTemplate(id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, name: t.name, price: Math.max(1, Math.round((t.value || 1) * PRICES.buyMarkup * buyCut(game))) }));
}

export function buyItem(game, id) {
  const p = game.state.player;
  const row = shopStock(game).find((s) => s.id === id);
  if (!row) { game.log('The Provisioner does not carry that.'); return false; }
  if ((p.gold || 0) < row.price) { game.log('The Provisioner names ' + row.price + ' gold, and your purse says no.'); return false; }
  if (p.inventory.length >= PACK_LIMIT) { game.log('Your pack has no room for it.'); return false; }
  p.gold -= row.price;
  p.inventory.push(deepItem(getItemTemplate(id)));
  game.log('Bought: ' + row.name + ', for ' + row.price + ' gold.');
  return true;
}

/* What a thing LOOKS worth. The fence pays for the look of it, because paying
 * for the truth of it would tell you the truth: an unread +3 blade priced at
 * four times its base would spill the enchantment through the price tag, and
 * an unread curse would give itself away by being cheap. */
export function apparentValue(it) {
  if (!it) return 0;
  if (it.identified === false) {
    const base = getItemTemplate(it.id);
    if (base) return base.value || 1;
  }
  return it.value || 1;
}

export function sellPrice(it, game) {
  return Math.max(1, Math.floor(apparentValue(it) * PRICES.sellShare * (game ? sellLift(game) : 1)));
}

/* `owner` is whichever member's pack the goods leave; the coin lands in the
 * purse at the counter — the one every shop price is quoted against. */
export function sellItem(game, it, owner) {
  const p = game.state.player;
  const from = owner || p;
  const idx = from.inventory.indexOf(it);
  if (idx < 0) { game.log((from === p ? 'You are' : from.name + ' is') + ' not carrying that.'); return false; }
  const paid = sellPrice(it, game);
  from.inventory.splice(idx, 1);
  game.unbindItem(it, from);
  p.gold = (p.gold || 0) + paid;
  game.log('Sold: ' + it.name + ', for ' + paid + ' gold.');
  return true;
}

/* The Lector's ledger: what in your possession still has something to tell. */
/* The Lector reads for the whole company: anything unread in anyone's pack
 * or on anyone's back is in the ledger, no hand-it-to-the-leader shuffle. */
export function unreadItems(game) {
  return game.companyItems().filter((it) => it.identified === false);
}

export function knownCurses(game) {
  return game.companyItems().filter((it) => it.cursed && it.identified !== false);
}

/* THE DROWNED LANTERN. One price, three rooms, and the whole company
 * rises whole: health, power, cooldowns — and wounds, the number nothing
 * free can fully reach. Mending closes them slowly for nothing; the inn
 * closes them tonight for coin. That is the economy of it. */
export function innCost(game) {
  const level = (game.state.player && game.state.player.level) || 1;
  return Math.max(10, Math.round((8 + 4 * level) * buyCut(game)));
}

export function takeRoom(game) {
  const p = game.state.player;
  const cost = innCost(game);
  if ((p.gold || 0) < cost) { game.log('A room is ' + cost + ' gold, and your purse says no.'); return false; }
  p.gold -= cost;
  for (const m of game.livingMembers()) {
    m.hp = m.maxhp;
    m.power = m.maxpower;
    m.wounds = 0;
    m.cooldowns = {};
  }
  game.log('A night at the Drowned Lantern: beds, board, and the lamps kept lit. The company rises whole. (' + cost + ' gold)');
  if (game.journal) game.journal('A night at the Drowned Lantern set the company right for ' + cost + ' gold.');
  return true;
}

export function identifyCost(game) {
  return Math.max(1, Math.round(PRICES.identify * buyCut(game)));
}

export function unbindCost(game) {
  return Math.max(1, Math.round(PRICES.unbind * buyCut(game)));
}

export function identifyItem(game, it) {
  const p = game.state.player;
  const fee = identifyCost(game);
  if (!it || it.identified !== false) { game.log('There is nothing unread about it.'); return false; }
  if ((p.gold || 0) < fee) { game.log('The Lector reads for ' + fee + ' gold, and your purse says no.'); return false; }
  p.gold -= fee;
  game.revealItem(it);
  game.log('The Lector runs a thumb along the rune: ' + it.name + '.' + (it.cursed ? ' Best not to wear that.' : ''));
  return true;
}

export function unbindCurse(game, it) {
  const p = game.state.player;
  const fee = unbindCost(game);
  if (!it || !it.cursed) { game.log('Nothing has hold of that.'); return false; }
  if ((p.gold || 0) < fee) { game.log('Unbinding costs ' + fee + ' gold, and your purse says no.'); return false; }
  p.gold -= fee;
  game.revealItem(it);
  it.cursed = false;
  game.log('The bell rings once over the ' + it.name + ', and what had hold of it lets go. It is only a thing again.');
  return true;
}

/* THE MUSTER. Companions are hired here, at the leader's own level — a
 * level-one hireling walking into the Upper Reaches is a corpse with a salary,
 * and levelling them by hand would be a chore pretending to be gameplay.
 * They are seasoned, and the seasoning is what you pay for. */

const MUSTER_NAMES = [
  'Brant', 'Sethra', 'Wren', 'Aldous', 'Merta', 'Kellin', 'Ophele', 'Dunstan',
  'Ivette', 'Corwin', 'Hesper', 'Tobias', 'Annis', 'Gareth', 'Lys', 'Roben',
];

export function hireCost(game) {
  const leader = game.state.player;
  const level = leader ? leader.level : 1;
  return PRICES.hire + PRICES.hirePerLevel * Math.max(0, level - 1);
}

export function musterRoster(game) {
  return Object.keys(CLASSES).map((id) => ({
    id,
    name: CLASSES[id].name,
    desc: CLASSES[id].desc,
    cost: hireCost(game),
  }));
}

export function hireMember(game, clsId) {
  const party = game.state.party;
  const leader = game.state.player;
  const c = CLASSES[clsId];
  if (!c) { game.log('Nobody of that calling is waiting.'); return null; }
  if (party.members.length >= PARTY_LIMIT) { game.log('The company is full: ' + PARTY_LIMIT + ' is as many as the stairs allow.'); return null; }
  const cost = hireCost(game);
  if ((leader.gold || 0) < cost) { game.log('A ' + c.name + ' of that seasoning asks ' + cost + ' gold, and your purse says no.'); return null; }

  const used = new Set(party.members.map((m) => m && m.name));
  const name = MUSTER_NAMES.find((n) => !used.has(n)) || 'Hireling';
  const b = makePlayer(name, clsId, initialStats(clsId));
  /* A hireling walks in with a past of their own — picked by their name,
   * so the same name always carries the same story — and arrives with
   * their learning unspent, for whoever pays to direct. */
  let h = 0;
  for (const ch of name + clsId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  game.applyBackground(b, BACKGROUNDS[h % BACKGROUNDS.length].id);
  /* Seasoned to the leader's level, using the same growth everyone else
   * gets — and dressed for it: weapon, armour off the class ladder, and a
   * shield where the calling carries one. A hire without the basic loadout
   * was a corpse with a salary twice over. */
  for (let i = 1; i < leader.level; i++) game.levelUp(b);
  game.outfitMember(b, leader.level);
  b.maxpower = game.computeMaxPower(b);
  b.power = b.maxpower;
  b.hp = b.maxhp;
  b.dungeonId = leader.dungeonId;
  b.floorIdx = leader.floorIdx;
  b.x = leader.x;
  b.y = leader.y;
  leader.gold -= cost;
  /* A hire signs on to the EXPEDITION: what fell, what was walked and how
   * deep is the company's knowledge, and the new sheet carries it too. */
  b.bossesSlain = { ...(leader.bossesSlain || {}) };
  b.visitedDungeons = { ...(leader.visitedDungeons || {}) };
  b.explored = { ...(leader.explored || {}) };
  b.deepest = { ...(leader.deepest || {}) };
  party.members.push(b);
  if (game.currentFloor) game.placePartyAround(game.currentFloor, leader);
  game.log(name + ' the ' + c.name + ' takes your coin and the road down. (' + cost + ' gold)');
  if (game.journal) game.journal(name + ' the ' + c.name + ' joined the company for ' + cost + ' gold.');
  return b;
}
