/* Combat maths: descending armour class, dice that are actually rolled, and a
 * level-up that makes you stronger rather than the monsters. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, XP_FOR_LEVEL } from '../public/js/base.js';
import { newGame, floorOf } from './helpers.mjs';

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

/* The curve is only right relative to what the floors actually hold, and the
 * old one was checked against a guess: the comment claimed floor one was worth
 * about 150 XP, level two cost exactly 150, and the floor in fact holds 106 —
 * so a player cleared the whole first floor of the game and finished it still
 * at level one, barely past halfway. Measure the content, not the formula. */
function templeXp(floors) {
  let total = 0;
  for (let f = 0; f < floors; f++) {
    for (let s = 0; s < 12; s++) {
      const { floor } = floorOf('temple', f, `xp-${f}-${s}`);
      total += floor.monsters.reduce((a, m) => a + (m.xp || 0), 0);
    }
  }
  return Math.round(total / 12);
}

/* gainXP subtracts as it goes, so reaching level N costs every step below it. */
function levelFor(xp) {
  let level = 1;
  let left = xp;
  while (left >= XP_FOR_LEVEL(level)) { left -= XP_FOR_LEVEL(level); level++; }
  return level;
}

test('clearing the first floor of the game earns the first level', () => {
  const floorOne = templeXp(1);
  assert.ok(floorOne >= XP_FOR_LEVEL(1),
    `Temple floor one holds ${floorOne} XP and level two costs ${XP_FOR_LEVEL(1)} — a whole floor, still level one`);
});

test('a dungeon is worth about the levels its boss is tuned against', () => {
  /* The three bosses were measured at levels 5-7, 8-10 and 11-13. A curve that
   * leaves the player short of that is what makes a boss feel unfair when the
   * boss itself is fine. */
  const wholeTemple = templeXp(4);
  const reached = levelFor(wholeTemple);
  assert.ok(reached >= 6 && reached <= 8,
    `a full clear of the Temple reaches level ${reached}; the Demon is tuned for 5-7`);
});

test('levelling never gets cheaper as you go', () => {
  for (let l = 1; l < 15; l++) {
    assert.ok(XP_FOR_LEVEL(l + 1) > XP_FOR_LEVEL(l), `level ${l + 2} costs less than level ${l + 1}`);
  }
});
