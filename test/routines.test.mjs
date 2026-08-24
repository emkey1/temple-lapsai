/* CLAW, CLAW, BITE.
 *
 * A routine replaces a creature's single attack: several blows, each rolled,
 * budgeted against the one it replaces — and grown by one leading blow per
 * extra body, which is the boss's answer to the party's action economy.
 * Three rules here were failed on paper before being written, each measured
 * by the design review: the depth bonus rides one entry, soak spends once per
 * body per action, and every entry aims wide.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { makePlayer, initialStats } from '../public/js/engine.js';
import { getMonster, MONSTERS } from '../public/js/base.js';
import { validateMonster } from '../lib/expansion.js';

function rig(seed = 'rt') {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  return { g, p: g.state.player };
}

/* A routine beast with flat 1-point dice, so arithmetic is exact. */
function clawer(g, x, y, over = {}) {
  const m = {
    t: { id: 'rt-beast', name: 'Render', glyph: 'R', tier: 5, hpMax: 99, ac: 10, toHit: 0,
         damage: { dice: 1, sides: 1, bonus: 2 }, xp: 1, goldMin: 0, goldMax: 0,
         props: [], speed: 1, aggroRange: 40,
         attacks: [
           { name: 'claw', damage: { dice: 1, sides: 1, bonus: 3 } },
           { name: 'claw', damage: { dice: 1, sides: 1, bonus: 3 } },
           { name: 'bite', damage: { dice: 1, sides: 1, bonus: 3 } },
         ] },
    x, y, hp: 99, maxhp: 99, boss: false, aggro: true,
    toHit: 100, dmg: { dice: 1, sides: 1, bonus: 2 }, xp: 1, goldMin: 0, goldMax: 0,
    revealed: true, lastSeen: 0, ...over,
  };
  g.currentFloor.monsters.push(m);
  return m;
}

function recruit(g, name = 'Second') {
  const a = g.state.party.members[0];
  const b = makePlayer(name, 'thief', initialStats('thief'));
  b.x = a.x; b.y = a.y; b.dungeonId = a.dungeonId; b.floorIdx = a.floorIdx;
  g.state.party.members.push(b);
  return b;
}

test('each blow of a routine rolls and logs on its own', () => {
  const { g, p } = rig('rt-blows');
  p.hp = p.maxhp = 500;
  const m = clawer(g, p.x + 1, p.y);
  g.logs.length = 0;
  g.monsterMelee(m);
  const lines = g.logs.filter((l) => /claw|bite/.test(l));
  assert.equal(lines.length, 3, `${lines.length} blow lines for a three-blow routine`);
});

test('soak spends once per action, not once per blow', () => {
  /* Against an overwhelming ward exactly ONE point lands per action — the
   * blow-that-always-lands floor, paid once. Spent per blow, three blows
   * would each pay their own floor and three points would land. That per-blow
   * flooring is what made a ward measurably worthless against routines:
   * identical damage through at ward four, five, six and seven. */
  const { g, p } = rig('rt-soak');
  p.hp = p.maxhp = 500;
  p.equipment.amulet = { name: 'Ward', kind: 'amulet', slot: 'amulet', effects: { resist: 50 } };
  const m = clawer(g, p.x + 1, p.y);
  g.monsterMelee(m);
  assert.equal(500 - p.hp, 1, `${500 - p.hp} landed through an overwhelming ward — soak is being spent per blow`);
});

test('the depth bonus rides one entry, not every blow', () => {
  /* m.dmg carries card bonus + depth. A +2 depth added per blow would be +6
   * across the routine — measured at 1.8x by floor ten. Entries are 1d1+3, so
   * with depth +2 exactly one blow lands 6 and the rest land 4. */
  const { g, p } = rig('rt-depth');
  p.hp = p.maxhp = 500;
  const m = clawer(g, p.x + 1, p.y, { dmg: { dice: 1, sides: 1, bonus: 4 } });   /* card 2 + depth 2 */
  g.monsterMelee(m);
  assert.equal(500 - p.hp, 4 + 4 + 6, `${500 - p.hp} landed across the routine`);
});

test('the god has arms for each of you', () => {
  /* The routine repeats whole per body in the company (capped at three):
   * additive extra blows were measured to leave every boss at a hundred
   * percent loss against any pair. */
  const { g, p } = rig('rt-arms');
  p.hp = p.maxhp = 500;
  const b = recruit(g);
  b.hp = b.maxhp = 500;
  const m = clawer(g, p.x + 1, p.y);
  b.x = m.x + 1; b.y = m.y;              /* both in reach */
  g.logs.length = 0;
  g.monsterMelee(m, p);
  const lines = g.logs.filter((l) => /claw|bite/.test(l));
  assert.equal(lines.length, 6, `${lines.length} blows against a pair — the routine should double`);
  assert.ok(p.hp < 500 && b.hp < 500, 'the routine did not spread across the bodies in reach');
});

test('against one body the routine stays its budgeted size', () => {
  const { g, p } = rig('rt-solo');
  p.hp = p.maxhp = 500;
  const m = clawer(g, p.x + 1, p.y);
  g.logs.length = 0;
  g.monsterMelee(m);
  const lines = g.logs.filter((l) => /claw|bite/.test(l));
  assert.equal(lines.length, 3);
});

test('every entry aims wide', () => {
  /* -1 to hit per blow: splitting one roll into three collapses armour's
   * payoff, and the penalty gives some of it back. Started at -2, which
   * measurably made the bosses EASIER solo than their single attacks. */
  const { g, p } = rig('rt-wide');
  p.hp = p.maxhp = 5000;
  const m = clawer(g, p.x + 1, p.y, { toHit: 0 });
  p.equipment.body = { name: 'Plate', kind: 'armor', slot: 'body', effects: { acBonus: 12 } };
  let landed = 0, swings = 0;
  for (let i = 0; i < 400; i++) {
    g.turn = i;                            /* fresh rolls each round */
    g.logs.length = 0;
    g.monsterMelee(m);
    swings += 3;
    landed += g.logs.filter((l) => /finds/.test(l)).length;
  }
  const rate = landed / swings;
  assert.ok(rate < 0.2, `blows land ${Math.round(rate * 100)}% of the time against heavy armour`);
});

test('the three bosses carry routines inside their budgets', () => {
  const avg = (d) => d.dice * (d.sides + 1) / 2 + (d.bonus || 0);
  for (const id of ['lapsai-demon', 'umber-hulk', 'great-wyrm']) {
    const m = getMonster(id);
    assert.ok(m.attacks && m.attacks.length >= 2 && m.attacks.length <= 3, `${id} has no routine`);
    const total = m.attacks.reduce((a, e) => a + avg(e.damage), 0);
    assert.ok(total <= avg(m.damage) * 1.3, `${id}: routine ${total} against card ${avg(m.damage)} — a buff in texture's clothes`);
    assert.ok(total >= avg(m.damage) * 0.8, `${id}: routine ${total} is a downgrade, not a replacement`);
  }
  /* And nothing ordinary sneaked one on. */
  const routiners = MONSTERS.filter((m) => m.attacks);
  assert.ok(routiners.length <= 5, `${routiners.length} monsters carry routines — this ships on bosses`);
});

test('the oracle may write a routine, budgeted, and not a fourth arm', () => {
  const ok = validateMonster({ name: 'Ripper', tier: 6, hpMax: 40, damage: { dice: 2, sides: 6 },
    attacks: [{ name: 'claw', damage: { dice: 1, sides: 4 } }, { name: 'bite', damage: { dice: 1, sides: 6 } }] });
  assert.ok(ok.attacks, 'a budgeted routine was rejected');
  assert.equal(ok.attacks.length, 2);

  const greedy = validateMonster({ name: 'Reaper', tier: 6, hpMax: 40, damage: { dice: 1, sides: 4 },
    attacks: [{ damage: { dice: 3, sides: 10, bonus: 5 } }, { damage: { dice: 3, sides: 10, bonus: 5 } }] });
  assert.equal(greedy.attacks, undefined, 'a routine far over budget got through');

  const hydra = validateMonster({ name: 'Hydra', tier: 6, hpMax: 40, damage: { dice: 4, sides: 6 },
    attacks: [1, 2, 3, 4, 5].map(() => ({ damage: { dice: 1, sides: 2 } })) });
  assert.ok(!hydra.attacks || hydra.attacks.length <= 3, 'more than three blows in a written routine');
});
