/* The pack used to render one row per object, so eight identical potions were
 * eight identical lines. Stacking is a display rule, but it only works if the
 * identity behind it is exact — merging two things that differ would hide a
 * curse or a spent wand. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { itemStackKey, getItemTemplate } from '../public/js/base.js';
import { PACK_LIMIT } from '../public/js/engine.js';
import { deepItem, applyMagic } from '../public/js/dice.js';
import { isWorn } from '../public/js/contract.js';

const potion = () => deepItem(getItemTemplate('potion-heal'));

test('two potions off the same shelf stack', () => {
  assert.equal(itemStackKey(potion()), itemStackKey(potion()));
});

test('a uid is not part of what makes two things the same', () => {
  const a = potion(), b = potion();
  assert.notEqual(a.uid, b.uid, 'the rig is not making distinct objects');
  assert.equal(itemStackKey(a), itemStackKey(b));
});

test('anything that would change the choice splits the stack', () => {
  const plain = deepItem(getItemTemplate('dagger'));
  const cursed = deepItem(getItemTemplate('dagger'));
  cursed.cursed = true;
  const magic = applyMagic(deepItem(getItemTemplate('dagger')), 2);
  const unknown = deepItem(getItemTemplate('dagger'));
  unknown.identified = false;

  const keys = [plain, cursed, magic, unknown].map(itemStackKey);
  assert.equal(new Set(keys).size, 4, 'a dagger you can trust merged with one you cannot');
});

test('a half-spent wand does not merge with a full one', () => {
  const full = deepItem(getItemTemplate('wand-of-fire'));
  const spent = deepItem(getItemTemplate('wand-of-fire'));
  spent.effects.charges = 3;
  assert.notEqual(itemStackKey(full), itemStackKey(spent));
});

test('key order in effects does not split an identical pair', () => {
  const a = potion();
  const b = potion();
  b.effects = Object.fromEntries(Object.entries(a.effects).reverse());
  assert.equal(itemStackKey(a), itemStackKey(b));
});

test('the belt loop refills itself from the rest of the stack', () => {
  const g = newGame('belt', 'fighter');
  const p = g.state.player;
  p.hp = 1;
  const three = [potion(), potion(), potion()];
  p.inventory.push(...three);
  assert.ok(g.bindToBelt(three[0]));
  const loop = p.belt.findIndex((e) => g.beltUid(e) === three[0].uid);
  assert.ok(loop >= 0);

  g.useBeltItem(loop);
  assert.equal(p.inventory.length, 2, 'the potion was not drunk');
  assert.ok(g.beltItem(loop), 'the loop emptied with two more potions in the pack');
  assert.equal(itemStackKey(g.beltItem(loop)), itemStackKey(three[1]));
});

test('refilling one loop never empties another', () => {
  const g = newGame('belt2', 'fighter');
  const p = g.state.player;
  p.hp = 1;
  const two = [potion(), potion()];
  p.inventory.push(...two);
  g.bindToBelt(two[0]);
  g.bindToBelt(two[1]);
  const loopA = p.belt.findIndex((e) => g.beltUid(e) === two[0].uid);
  const loopB = p.belt.findIndex((e) => g.beltUid(e) === two[1].uid);

  g.useBeltItem(loopA);
  assert.equal(p.belt[loopA], null, 'the loop stole the potion out of the other loop');
  assert.ok(g.beltItem(loopB), 'the other loop lost its potion');
});

test('the last of a stack leaves the loop empty rather than lying', () => {
  const g = newGame('belt3', 'fighter');
  const p = g.state.player;
  p.hp = 1;
  const only = potion();
  p.inventory.push(only);
  g.bindToBelt(only);
  const loop = p.belt.findIndex((e) => g.beltUid(e) === only.uid);
  g.useBeltItem(loop);
  assert.equal(g.beltItem(loop), null);
});

test('the pack limit the gear tab prints is the one the engine enforces', () => {
  const g = newGame('full', 'fighter');
  const p = g.state.player;
  while (p.inventory.length < PACK_LIMIT) p.inventory.push(potion());
  const before = p.inventory.length;
  g.unequip('weapon');
  assert.equal(p.inventory.length, before, 'the pack took more than it says it holds');
});

/* WHAT A THING IS, BEFORE WHERE IT WOULD SIT.
 *
 * A wand's slot is `weapon`, so that a staff can be wielded and lend its
 * damage to the arm. Anything that asked the slot before the kind therefore
 * read every wand in the game as clothing — and the pack's click handler did,
 * while the button's label and the engine both asked the kind. The button
 * said FIRE and equipped the thing out of the pack, where nothing could fire
 * it. One rule now, in contract.js, and all three ask it.
 */

test('a wand is used, not worn, however weapon-shaped its slot is', () => {
  for (const id of ['wand-of-fire', 'wand-of-healing', 'wand-of-frost']) {
    const it = deepItem(getItemTemplate(id));
    assert.equal(it.slot, 'weapon', id + ' no longer sits in the weapon slot');
    assert.equal(isWorn(it), false, id + ' reads as something you put on');
  }
});

test('and the things that really are worn still are', () => {
  for (const [id, slot] of [['broadsword', 'weapon'], ['chainmail', 'body'], ['buckler', 'shield']]) {
    const tpl = getItemTemplate(id);
    if (!tpl) continue;
    const it = deepItem(tpl);
    assert.equal(it.slot, slot, id + ' changed slot');
    assert.equal(isWorn(it), true, id + ' stopped being wearable');
  }
  for (const id of ['potion-heal', 'scroll-map']) {
    const tpl = getItemTemplate(id);
    if (tpl) assert.equal(isWorn(deepItem(tpl)), false, id + ' reads as wearable');
  }
});

test('firing a wand from the pack spends a charge and leaves it in the pack', () => {
  const g = newGame('wand-fire');
  g.loadFloor(0);
  const p = g.state.player;
  const wand = deepItem(getItemTemplate('wand-of-fire'));
  p.inventory.push(wand);
  const charges = wand.effects.charges;
  /* Something to lance, or the wand fizzles without spending anything. */
  const m = g.currentFloor.monsters.find((x) => x.hp > 0);
  if (m) { m.x = p.x + 2; m.y = p.y; m.hp = m.maxhp = 9999; }
  g.useItem(wand);
  assert.equal(wand.effects.charges, charges - 1, 'the wand did not fire');
  assert.notEqual(p.equipment.weapon, wand, 'FIRE equipped the wand instead');
  assert.ok(p.inventory.includes(wand), 'the wand left the pack, where nothing can fire it');
});

test('a healing wand mends rather than being strapped on', () => {
  const g = newGame('wand-heal');
  g.loadFloor(0);
  const p = g.state.player;
  const wand = deepItem(getItemTemplate('wand-of-healing'));
  p.inventory.push(wand);
  p.hp = 1;
  g.useItem(wand);
  assert.ok(p.hp > 1, 'the wand of healing was worn instead of used');
  assert.notEqual(p.equipment.weapon, wand, 'it ended up in the weapon slot');
});

test('but a wand can still be taken in hand deliberately', () => {
  const g = newGame('wand-wield');
  g.loadFloor(0);
  const p = g.state.player;
  const wand = deepItem(getItemTemplate('wand-of-fire'));
  p.inventory.push(wand);
  const charges = wand.effects.charges;
  g.equip(wand, p);
  assert.equal(p.equipment.weapon, wand, 'WIELD could not put the wand in the hand');
  assert.equal(wand.effects.charges, charges, 'taking it in hand burned a charge');
});
