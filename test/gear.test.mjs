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
