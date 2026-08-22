/* Combat maths: descending armour class, dice that are actually rolled, and a
 * level-up that makes you stronger rather than the monsters. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, XP_FOR_LEVEL } from '../public/js/base.js';
import { newGame } from './helpers.mjs';

test('armour class descends: armour and DEX both make you harder to hit', () => {
  const g = newGame('ac');
  const p = g.state.player;
  const bare = g.derived().ac;

  p.equipment.body = { name: 'Plate', kind: 'armor', slot: 'body', effects: { acBonus: 6 } };
  assert.ok(g.derived().ac < bare, 'wearing plate made the player easier to hit');

  p.equipment.body = null;
  p.stats.dex = 18;
  assert.ok(g.derived().ac < bare, 'high DEX made the player easier to hit');
});

test('the nimble class is not the easiest one to hit', () => {
  const ac = {};
  for (const id of Object.keys(CLASSES)) ac[id] = newGame('cls-' + id, id).derived().ac;
  assert.ok(ac.thief < ac.mage, `thief AC ${ac.thief} should beat mage AC ${ac.mage}`);
  assert.ok(ac.fighter < ac.mage, `fighter AC ${ac.fighter} should beat mage AC ${ac.mage}`);
});

test('3d6 rolls three dice instead of tripling one', () => {
  const g = newGame('dice');
  const seen = new Set();
  for (let t = 0; t < 400; t++) {
    g.turn = t;
    seen.add(g.rollDamage({ dice: 3, sides: 6, bonus: 0 }));
  }
  assert.ok(Math.min(...seen) >= 3 && Math.max(...seen) <= 18, 'out of 3d6 range');
  /* Tripling one d6 can only ever produce multiples of 3. */
  assert.ok([...seen].some((v) => v % 3 !== 0), 'every roll was a multiple of 3 — still multiplying');
  assert.ok(seen.size > 6, `only ${seen.size} distinct results from 3d6`);
});

test('levelling up raises the player\'s own numbers', () => {
  const g = newGame('level');
  const p = g.state.player;
  const before = g.derived();
  p.level = 7;
  const after = g.derived();
  assert.ok(after.toHit > before.toHit, 'to-hit did not grow with level');
  assert.ok(after.dmg.bonus > before.dmg.bonus, 'damage did not grow with level');
});

test('monsters are scaled by depth, not by the player\'s level', () => {
  const shallow = newGame('depth-a');
  shallow.loadFloor(0);
  const hpAtLevel1 = shallow.currentFloor.monsters.map((m) => m.maxhp);

  const levelled = newGame('depth-a');
  levelled.state.player.level = 9;
  levelled.loadFloor(0);
  const hpAtLevel9 = levelled.currentFloor.monsters.map((m) => m.maxhp);

  assert.deepEqual(hpAtLevel9, hpAtLevel1, 'levelling up inflated the monsters');
});

test('the XP curve is worth about a level per floor', () => {
  /* Four floors of the Temple are worth roughly 4,000 XP all told. */
  const toLevel5 = [1, 2, 3, 4].reduce((sum, l) => sum + XP_FOR_LEVEL(l), 0);
  assert.ok(toLevel5 > 2000 && toLevel5 < 4000, `cumulative XP to level 5 is ${toLevel5}`);
  assert.ok(XP_FOR_LEVEL(1) <= 200, `level 2 costs ${XP_FOR_LEVEL(1)} XP — too far for one floor`);
});
