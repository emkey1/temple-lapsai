/* THE WHETSTONE'S ECONOMY.
 *
 * The oldest open playtest note: "what is the purpose of gold, other than as
 * an excuse to resurrect the player?" Until now, nothing. The Gemstone's own
 * card has said "worth 40 gp to the right buyer" since the beginning, and
 * there has never been a buyer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { getItemTemplate } from '../public/js/base.js';
import { deepItem, applyMagic, applyCurse } from '../public/js/dice.js';
import { PACK_LIMIT } from '../public/js/engine.js';
import {
  PRICES, shopStock, buyItem, apparentValue, sellPrice, sellItem,
  unreadItems, knownCurses, identifyItem, unbindCurse,
} from '../public/js/town.js';

function rig(seed = 't', gold = 500) {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  g.state.player.gold = gold;
  return { g, p: g.state.player };
}

/* ---- the shop ---- */

test('the shelf always holds the essentials, and grows with your standing', () => {
  const { g, p } = rig('t-stock');
  const names = (s) => s.map((r) => r.id);
  assert.ok(names(shopStock(g)).includes('scroll-identify'), 'no way to buy a reading');
  assert.ok(names(shopStock(g)).includes('potion-heal'));
  const before = shopStock(g).length;

  p.bossesSlain.temple = true;
  assert.ok(shopStock(g).length > before, 'a boss slain and the shelf never changed');
  assert.ok(names(shopStock(g)).includes('scroll-remove-curse'));
  p.bossesSlain.upper = true;
  assert.ok(names(shopStock(g)).includes('scroll-sanctuary'));
});

test('buying costs the listed price and lands in the pack', () => {
  const { g, p } = rig('t-buy');
  const row = shopStock(g).find((r) => r.id === 'scroll-identify');
  const before = p.gold;
  assert.ok(buyItem(g, 'scroll-identify'));
  assert.equal(p.gold, before - row.price);
  assert.ok(p.inventory.some((it) => it.id === 'scroll-identify'));
});

test('a thin purse and a full pack both refuse cleanly', () => {
  const { g, p } = rig('t-refuse', 1);
  const packBefore = p.inventory.length;
  assert.equal(buyItem(g, 'potion-heal'), false);
  assert.equal(p.gold, 1, 'the shop took money it refused for');
  assert.equal(p.inventory.length, packBefore);

  p.gold = 500;
  while (p.inventory.length < PACK_LIMIT) p.inventory.push(deepItem(getItemTemplate('potion-heal')));
  assert.equal(buyItem(g, 'potion-heal'), false);
  assert.equal(p.gold, 500, 'the shop charged for an item it could not hand over');
});

test('the shop does not sell what it does not carry', () => {
  const { g, p } = rig('t-nostock');
  assert.equal(buyItem(g, 'plate'), false);
  assert.equal(buyItem(g, 'scroll-sanctuary'), false, 'endgame stock on the shelf from the start');
  assert.equal(p.gold, 500);
});

/* ---- the fence ---- */

test('the right buyer finally exists', () => {
  const { g, p } = rig('t-gem', 0);
  const gem = deepItem(getItemTemplate('gem'));
  p.inventory.push(gem);
  assert.ok(sellItem(g, gem));
  assert.ok(p.gold > 0, 'the Gemstone sold for nothing');
  assert.equal(p.inventory.includes(gem), false);
});

test('selling pays the look of a thing, not the truth of it', () => {
  /* An unread +3 blade priced at four times its base would spill the
   * enchantment through the price tag, and an unread curse would give itself
   * away by being cheap. The fence pays for what it appears to be. */
  const plain = deepItem(getItemTemplate('broadsword'));
  const blessed = applyMagic(deepItem(getItemTemplate('broadsword')), 3);
  const trapped = applyCurse(deepItem(getItemTemplate('broadsword')), 3);
  assert.equal(sellPrice(blessed), sellPrice(plain), 'the blessing leaked through the price');
  assert.equal(sellPrice(trapped), sellPrice(plain), 'the curse leaked through the price');

  /* Read, the truth is paid for — more for the blessing, less for the trap. */
  blessed.identified = true;
  trapped.identified = true;
  assert.ok(sellPrice(blessed) > sellPrice(plain));
  assert.ok(sellPrice(trapped) < sellPrice(plain));
});

test('selling does not read the rune for free', () => {
  const { g, p } = rig('t-noleak', 0);
  const mystery = applyMagic(deepItem(getItemTemplate('dagger')), 2);
  const twin = applyMagic(deepItem(getItemTemplate('dagger')), 2);
  p.inventory.push(mystery, twin);
  sellItem(g, mystery);
  assert.equal(twin.identified, false, 'selling one twin identified the other');
});

test('selling takes it off the belt as well as out of the pack', () => {
  const { g, p } = rig('t-belt', 0);
  const potion = deepItem(getItemTemplate('potion-heal'));
  p.inventory.push(potion);
  g.bindToBelt(potion);
  sellItem(g, potion);
  assert.ok(!p.belt.some((e) => g.beltUid(e) === potion.uid), 'the belt still points at a sold item');
});

test('what is worn cannot be sold from under you', () => {
  const { g, p } = rig('t-worn', 0);
  const worn = p.equipment.weapon;
  assert.ok(worn, 'the rig has no starting weapon');
  assert.equal(sellItem(g, worn), false);
  assert.equal(p.equipment.weapon, worn);
});

test('every price is at least a coin', () => {
  for (const id of ['dagger', 'gold-pile', 'gem']) {
    const it = deepItem(getItemTemplate(id));
    it.value = 0;
    assert.ok(sellPrice(it) >= 1, `${id} sells for nothing`);
  }
  const { g } = rig('t-floor');
  for (const row of shopStock(g)) assert.ok(row.price >= 1);
});

/* ---- the Lector ---- */

test('the Lector reads a rune for coin, and warns about what it says', () => {
  const { g, p } = rig('t-read');
  const trap = applyCurse(deepItem(getItemTemplate('broadsword')), 2);
  p.inventory.push(trap);
  assert.deepEqual(unreadItems(g), [trap]);
  const before = p.gold;
  g.logs.length = 0;
  assert.ok(identifyItem(g, trap));
  assert.equal(p.gold, before - PRICES.identify);
  assert.equal(trap.identified, true);
  assert.match(trap.name, /accursed/);
  assert.match(g.logs.join(' '), /Best not to wear that/);
  assert.deepEqual(unreadItems(g), []);
});

test('the Lector unbinds a worn curse, and then it comes off', () => {
  const { g, p } = rig('t-unbind');
  const trap = applyCurse(deepItem(getItemTemplate('broadsword')), 2);
  trap.identified = true;
  trap.name = trap.trueName;
  p.equipment.weapon = trap;
  assert.deepEqual(knownCurses(g), [trap]);
  const before = p.gold;
  assert.ok(unbindCurse(g, trap));
  assert.equal(p.gold, before - PRICES.unbind);
  assert.equal(trap.cursed, false);
  g.unequip('weapon');
  assert.equal(p.equipment.weapon, null, 'unbound, it still would not come off');
});

test('an unread curse can be unbound too — paying for the reading in the act', () => {
  const { g, p } = rig('t-blind-unbind');
  const trap = applyCurse(deepItem(getItemTemplate('leather-armor')), 1);
  p.equipment.body = trap;
  assert.ok(unbindCurse(g, trap));
  assert.equal(trap.identified, true, 'the loosening words taught you nothing');
  assert.equal(trap.cursed, false);
});

test('the Lector refuses a thin purse and an honest item alike', () => {
  const { g, p } = rig('t-refuse2', 5);
  const trap = applyCurse(deepItem(getItemTemplate('dagger')), 1);
  p.inventory.push(trap);
  assert.equal(identifyItem(g, trap), false);
  assert.equal(p.gold, 5);
  assert.equal(trap.identified, false, 'a refused reading read it anyway');

  p.gold = 500;
  const honest = deepItem(getItemTemplate('mace'));
  assert.equal(identifyItem(g, honest), false, 'paid to read a thing with nothing written on it');
  assert.equal(unbindCurse(g, honest), false);
  assert.equal(p.gold, 500);
});
