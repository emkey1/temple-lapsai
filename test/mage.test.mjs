/* The Mage.
 *
 * "I'm a first level mage. I've cast my one magic missile today. I guess I'll
 * carry people's stuff now." The power pool did not refill in combat at all,
 * so a Mage out of power was a commoner with a stick and the worst armour in
 * the game — measured, it won 13% of the first boss fight and 0% of the other
 * two. These tests pin the three things that fixed it, and the one thing that
 * must not follow from them: the Mage must not become the best class.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { ABILITIES, CLASSES } from '../public/js/base.js';
import { validateAbility } from '../lib/expansion.js';

function mageAt(level, seed = 'm') {
  const g = newGame(`${seed}-${level}`, 'mage');
  for (let i = 1; i < level; i++) g.levelUp();
  g.loadFloor(0);
  return { g, p: g.state.player };
}

/* Something in reach to aim at, so an ability resolves rather than fizzling. */
function target(g, at = 2) {
  const p = g.state.player;
  const m = g.currentFloor.monsters.find((x) => x.hp > 0);
  if (!m) return null;
  m.x = p.x + at; m.y = p.y;
  m.hp = m.maxhp = 9999;
  m.aggro = true; m.revealed = true; m.lastSeen = g.turn;
  g.currentFloor.monsters = [m];
  g.computeVisibility();
  return m;
}

test('a Mage out of power still has something to cast', () => {
  const { g, p } = mageAt(1);
  const m = target(g);
  p.power = 0;
  const before = m.hp;
  g.activateAbility('witch-spark');
  assert.ok(m.hp < before, 'an empty Mage could do nothing at all');
});

test('the small working hands power back rather than taking it', () => {
  const { g, p } = mageAt(4);
  target(g);
  p.power = 0;
  g.activateAbility('witch-spark');
  assert.ok(p.power > 0, 'Witch-Spark cost power instead of returning it');
});

test('sparking never fills the pool past its brim', () => {
  const { g, p } = mageAt(6);
  target(g);
  p.power = p.maxpower;
  for (let i = 0; i < 10; i++) g.activateAbility('witch-spark');
  assert.equal(p.power, p.maxpower);
});

test('the small working stays small', () => {
  /* It is a floor to stand on, not a career: flat dice, no INT, so it cannot
   * out-scale the spell it is meant to buy time for. */
  const spark = ABILITIES.find((a) => a.id === 'witch-spark');
  const bolt = ABILITIES.find((a) => a.id === 'firebolt');
  assert.equal(spark.powerCost, 0);
  assert.ok(!spark.damage.int, 'the cantrip scales with INT, which is the big spell\'s job');
  assert.ok(spark.damage.dice * spark.damage.sides < bolt.damage.dice * bolt.damage.sides,
    'the free working hits as hard as the one you pay for');
  assert.ok(spark.powerGain < bolt.powerCost,
    'one spark pays for a Firebolt outright, which is a fountain, not an economy');
});

test('an ability grows with practice, as a weapon does', () => {
  /* Every ability in the game was flat dice forever — a level 12 Firebolt was
   * the same 1d8+INT as a level 1 one — while a fighter's damage grew with the
   * weapon, the strength and the level. That is why the Mage measured as the
   * WEAKEST attacker at depth despite having the only attack that never misses. */
  const roll = (level) => {
    const { g } = mageAt(level, 'grow');
    const m = target(g);
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const before = m.hp;
      g.state.player.power = g.state.player.maxpower;
      g.activateAbility('firebolt');
      total += before - m.hp;
    }
    return total / 400;
  };
  const low = roll(1);
  const high = roll(12);
  assert.ok(high > low * 1.4, `Firebolt does ${low.toFixed(1)} at level 1 and ${high.toFixed(1)} at level 12`);
});

test('the Mage has a skin to stand behind, and it wears off', () => {
  const { g, p } = mageAt(4);
  assert.equal(g.derived().resist, 0);
  g.activateAbility('ashen-mantle');
  const warded = g.derived().resist;
  assert.ok(warded > 0, 'the mantle turned nothing aside');
  const turns = p.buffs.ward;
  assert.ok(turns > 0 && turns < 20, `a ward lasting ${turns} turns is not a decision`);
  for (let i = 0; i < turns + 2; i++) g.endPlayerTurn();
  assert.equal(g.derived().resist, 0, 'the ward never wore off');
});

test('the ward actually stops damage reaching the player', () => {
  const { g, p } = mageAt(6);
  const m = target(g, 1);
  m.dmg = { dice: 1, sides: 1, bonus: 9 };   /* a flat 10 every time */
  m.toHit = 40;                              /* and it never misses */
  const hit = () => { p.hp = p.maxhp; g.monsterMelee(m); return p.maxhp - p.hp; };
  const bare = hit();
  g.activateAbility('ashen-mantle');
  const warded = hit();
  assert.ok(warded < bare, `bare ${bare}, warded ${warded}`);
});

test('the Mage is no longer the frailest thing in the dungeon by a mile', () => {
  /* Not a buff to hit points — a check that the class is still the frail one,
   * so the fix did not quietly turn the Mage into a fighter. */
  const hp = {};
  for (const cls of ['fighter', 'thief', 'mage', 'cleric']) {
    const g = newGame('frail-' + cls, cls);
    for (let i = 1; i < 8; i++) g.levelUp();
    hp[cls] = g.state.player.maxhp;
  }
  assert.ok(hp.mage < hp.fighter, 'the Mage is as tough as the Fighter');
  assert.equal(CLASSES.mage.hpDie, 6, 'the Mage stopped being frail');
});

/* ---- what the Library may write ---- */

test('the oracle cannot write a power fountain', () => {
  const greedy = validateAbility({ name: 'Endless Font', cls: 'mage', kind: 'damage', level: 1, powerCost: 0, powerGain: 99 });
  assert.ok(greedy.powerGain <= 2, `powerGain came back as ${greedy.powerGain}`);
  const none = validateAbility({ name: 'Plain Bolt', cls: 'mage', kind: 'damage', level: 1 });
  assert.equal(none.powerGain, undefined, 'every generated ability now returns power');
});

test('a written ward is a ward, and anything else is an edge', () => {
  const ward = validateAbility({ name: 'Rime Skin', cls: 'mage', kind: 'buff', level: 3, buff: 'ward', bonus: 2, turns: 5 });
  assert.equal(ward.buff, 'ward');
  assert.equal(ward.turns, 5);
  const odd = validateAbility({ name: 'Odd Skin', cls: 'mage', kind: 'buff', level: 3, buff: 'something-else' });
  assert.equal(odd.buff, 'might', 'an unknown buff leaked through instead of falling back');
  const notABuff = validateAbility({ name: 'Bolt', cls: 'mage', kind: 'damage', level: 1, buff: 'ward' });
  assert.equal(notABuff.buff, undefined, 'a damage ability came back carrying a buff kind');
});

test('a written ward reaches the player through the same door as the shipped one', () => {
  const rime = { ...validateAbility({ name: 'Rime Skin', cls: 'mage', kind: 'buff', level: 1, buff: 'ward', bonus: 2, turns: 4, powerCost: 2 }), id: 'exp-rime' };
  const g = newGame('written-ward', 'mage');
  g.registry.abilities = [rime];
  g.loadFloor(0);
  g.state.player.power = g.state.player.maxpower;
  assert.equal(g.derived().resist, 0);
  g.activateAbility('exp-rime');
  assert.ok(g.derived().resist > 0, 'a ward the Library wrote turned nothing aside');
});
