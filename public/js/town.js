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

import { getItemTemplate } from './base.js';
import { deepItem } from './dice.js';
import { PACK_LIMIT } from './engine.js';

export const PRICES = {
  buyMarkup: 2,      /* the shop sells at twice an item's worth — it is a shop */
  sellShare: 0.4,    /* and buys at two-fifths, which is how shops go on existing */
  identify: 20,      /* the Lector reads one rune */
  unbind: 80,        /* or prises one curse loose — a Draught costs about this */
};

/* What is on the shelf. It grows with the expedition's standing: the deeper
 * the world knows you have been, the better the Provisioner's suppliers. */
export function shopStock(game) {
  const p = game.state.player;
  const slain = p ? Object.keys(p.bossesSlain || {}).filter((k) => p.bossesSlain[k]).length : 0;
  const ids = ['potion-heal', 'potion-power', 'scroll-identify'];
  if (slain >= 1) ids.push('potion-major-heal', 'scroll-remove-curse');
  if (slain >= 2) ids.push('scroll-sanctuary', 'potion-remove-curse');
  return ids
    .map((id) => getItemTemplate(id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, name: t.name, price: Math.max(1, (t.value || 1) * PRICES.buyMarkup) }));
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

export function sellPrice(it) {
  return Math.max(1, Math.floor(apparentValue(it) * PRICES.sellShare));
}

export function sellItem(game, it) {
  const p = game.state.player;
  const idx = p.inventory.indexOf(it);
  if (idx < 0) { game.log('You are not carrying that.'); return false; }
  const paid = sellPrice(it);
  p.inventory.splice(idx, 1);
  game.unbindItem(it);
  p.gold = (p.gold || 0) + paid;
  game.log('Sold: ' + it.name + ', for ' + paid + ' gold.');
  return true;
}

/* The Lector's ledger: what in your possession still has something to tell. */
export function unreadItems(game) {
  const p = game.state.player;
  return [...(p.inventory || []), ...Object.values(p.equipment || {})]
    .filter((it) => it && it.identified === false);
}

export function knownCurses(game) {
  const p = game.state.player;
  return [...(p.inventory || []), ...Object.values(p.equipment || {})]
    .filter((it) => it && it.cursed && it.identified !== false);
}

export function identifyItem(game, it) {
  const p = game.state.player;
  if (!it || it.identified !== false) { game.log('There is nothing unread about it.'); return false; }
  if ((p.gold || 0) < PRICES.identify) { game.log('The Lector reads for ' + PRICES.identify + ' gold, and your purse says no.'); return false; }
  p.gold -= PRICES.identify;
  game.revealItem(it);
  game.log('The Lector runs a thumb along the rune: ' + it.name + '.' + (it.cursed ? ' Best not to wear that.' : ''));
  return true;
}

export function unbindCurse(game, it) {
  const p = game.state.player;
  if (!it || !it.cursed) { game.log('Nothing has hold of that.'); return false; }
  if ((p.gold || 0) < PRICES.unbind) { game.log('Unbinding costs ' + PRICES.unbind + ' gold, and your purse says no.'); return false; }
  p.gold -= PRICES.unbind;
  game.revealItem(it);
  it.cursed = false;
  game.log('The Lector speaks the loosening words over the ' + it.name + '. It is only a thing again.');
  return true;
}
