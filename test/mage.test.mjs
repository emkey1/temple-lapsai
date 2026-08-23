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
import { ABILITIES, CLASSES, getItemTemplate } from '../public/js/base.js';
import { deepItem } from '../public/js/dice.js';
import { validateAbility } from '../lib/expansion.js';
import { abilityPowerNote } from '../public/js/describe.js';

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

test('the small working costs nothing, and hands nothing back either', () => {
  /* Ebb & Flow is the whole of the economy. A spark that ALSO paid put the
   * Mage above every other class at the first boss — 92% against a Fighter's
   * 77% — which is the overshoot this splits apart. */
  const { g, p } = mageAt(4);
  target(g);
  p.power = 7;
  g.activateAbility('witch-spark');
  assert.ok(p.power <= 7, 'the spark paid power back on top of the tide');
});

/* ---- the tide ---- */

test('the reserve seeps back while a fight is on', () => {
  const { g, p } = mageAt(6);
  target(g, 1);
  p.power = 0;
  for (let i = 0; i < 12; i++) g.endPlayerTurn();
  assert.ok(p.power > 0, 'the reserve never moved with something in the room');
});

test('a fraction of a point a turn is banked, not rounded away or rounded up', () => {
  const { g, p } = mageAt(1);
  const der = g.derived();
  const perTurn = der.maxpower * der.powerRegen;
  assert.ok(perTurn > 0 && perTurn < 1, `the seep is ${perTurn} a turn, which rounding would ruin either way`);
  target(g, 1);
  p.power = 0;
  g.endPlayerTurn();
  assert.equal(p.power, 0, 'a fraction of a point was rounded up into a whole one');
  for (let i = 0; i < 10; i++) g.endPlayerTurn();
  assert.ok(p.power >= 1, 'the fractions never added up to anything');
});

test('lingering in a fight is never quicker than walking away from one', () => {
  const { g } = mageAt(9);
  const der = g.derived();
  assert.ok(der.powerRegen < 0.045,
    `fighting renews at ${der.powerRegen} against resting's 0.045 — the wrong way round`);
});

test('a blow landed with a staff draws power through it; a sword does not', () => {
  const { g, p } = mageAt(6);
  const m = target(g, 1);
  p.equipment.weapon = deepItem(getItemTemplate('staff'));
  p.power = 0;
  for (let i = 0; i < 12; i++) { g.attackMonster(m); }
  const withFocus = p.power;
  assert.ok(withFocus > 0, 'the staff drew nothing');

  p.equipment.weapon = deepItem(getItemTemplate('broadsword'));
  p.power = 0;
  for (let i = 0; i < 12; i++) { g.attackMonster(m); }
  assert.ok(p.power < withFocus, 'a broadsword recharged the Mage');
  assert.equal(g.isFocusWeapon(p.equipment.weapon), false);
});

test('the tide never overfills the cup', () => {
  const { g, p } = mageAt(6);
  const m = target(g, 1);
  p.equipment.weapon = deepItem(getItemTemplate('staff'));
  p.power = p.maxpower;
  for (let i = 0; i < 20; i++) { g.attackMonster(m); g.endPlayerTurn(); }
  assert.ok(p.power <= p.maxpower, `${p.power} of ${p.maxpower}`);
});

test('only the Mage has a tide', () => {
  for (const cls of ['fighter', 'thief', 'cleric']) {
    const g = newGame('tide-' + cls, cls);
    for (let i = 1; i < 9; i++) g.levelUp();
    assert.equal(g.derived().powerRegen, 0, `${cls} renews power mid-fight`);
    assert.equal(g.derived().focusPower, 0, `${cls} draws power through its weapon`);
  }
});

test('the renewal is written on the card, not left to be discovered', () => {
  const ebb = ABILITIES.find((a) => a.id === 'ebb-flow');
  const note = abilityPowerNote(ebb, { maxpower: 30 });
  assert.match(note, /pwr/, 'the passive says nothing about what it does');
  assert.match(note, /focus/, 'the staff clause is invisible');
  assert.equal(abilityPowerNote(ABILITIES.find((a) => a.id === 'firebolt'), { maxpower: 30 }), '');
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
  /* Renewal is granted by one passive the game ships, and the validator builds
   * its output from a whitelist — so a model asking for it is simply dropped.
   * A Fighter with in-combat renewal casts Second Wind, which mends half its
   * maximum health, without limit. */
  const greedy = validateAbility({
    name: 'Endless Well', cls: 'fighter', kind: 'passive', level: 1,
    powerRegen: 5, focusPower: 99, powerGain: 99,
  });
  assert.equal(greedy.powerRegen, undefined);
  assert.equal(greedy.focusPower, undefined);
  assert.equal(greedy.powerGain, undefined);

  const g = newGame('fountain', 'fighter');
  g.registry.abilities = [{ ...greedy, id: 'exp-well' }];
  g.loadFloor(0);
  assert.equal(g.derived().powerRegen, 0, 'a written passive granted a tide anyway');
});

test('and the engine bounds it even if one ever got through', () => {
  const g = newGame('bounded', 'mage');
  g.registry.abilities = [{ cls: 'mage', level: 1, kind: 'passive', id: 'exp-flood', powerRegen: 5, focusPower: 99 }];
  g.loadFloor(0);
  const der = g.derived();
  assert.ok(der.powerRegen <= 0.04, `powerRegen came out at ${der.powerRegen}`);
  assert.ok(der.focusPower <= 3, `focusPower came out at ${der.focusPower}`);
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
