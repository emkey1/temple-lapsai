/* Combat maths: descending armour class, dice that are actually rolled, and a
 * level-up that makes you stronger rather than the monsters. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSES, XP_FOR_LEVEL, ABILITIES } from '../public/js/base.js';
import { abilityReach } from '../public/js/contract.js';
import { validateAbility } from '../lib/expansion.js';
import { newGame, floorOf } from './helpers.mjs';
import { W, H } from '../public/js/mapgen.js';

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
  /* FORTY seeds, not twelve. A floor's worth swings from about 70 XP to
   * about 150 depending on what the pool rolls, so a dozen samples put an
   * error bar of tens of XP around a claim that turns on two — and the
   * suite went red for a change to DOORS, which shifted the generator's
   * stream without touching the bestiary. Measured over forty, floor one
   * holds ~112 against the 100 that level two costs. */
  const SEEDS = 40;
  let total = 0;
  for (let f = 0; f < floors; f++) {
    for (let s = 0; s < SEEDS; s++) {
      const { floor } = floorOf('temple', f, `xp-${f}-${s}`);
      total += floor.monsters.reduce((a, m) => a + (m.xp || 0), 0);
    }
  }
  return Math.round(total / SEEDS);
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

/* THE WORKINGS THAT TURN ON THE SPOT.
 *
 * Three level-nine capstones spread their damage, and each one says a
 * different thing about where it reaches from. Two of them used to be read as
 * "an aura with a reach of one tile", which sent them looking for an adjacent
 * monster to be the centre of themselves — so a thief with a room in view and
 * nothing touching her was told her working found no target in the light, and
 * one step closer it hit only the single foe she had walked up to.
 */

/* A fight, with monsters exactly where the test wants them and nowhere else.
 * The company stands mid-map so that an offset in any direction is still a
 * tile the floor has, and the light is forced on afterwards: these are tests
 * about reach, not about what a wall happens to be standing in front of. */
function fightAt(level, clsId, seed, at) {
  const g = newGame(seed, clsId);
  for (let i = 1; i < level; i++) g.levelUp();
  g.loadFloor(0);
  const p = g.state.player;
  p.x = Math.floor(W / 2); p.y = Math.floor(H / 2);
  const stock = g.currentFloor.monsters.filter((m) => m.hp > 0);
  const placed = at.map(([dx, dy], i) => {
    const m = stock[i % stock.length];
    const copy = { ...m, x: p.x + dx, y: p.y + dy, hp: 9999, maxhp: 9999, aggro: true, revealed: true };
    return copy;
  });
  g.currentFloor.monsters = placed;
  g.computeVisibility();
  /* Whatever the floor's own walls do to the light, these tests are about
   * reach and not about line of sight. */
  for (const m of placed) { if (g.vis[m.y]) g.vis[m.y][m.x] = true; }
  return { g, p, monsters: placed };
}

const hurt = (ms) => ms.filter((m) => m.hp < m.maxhp).length;

test('Fatal Flurry reaches every foe in the light, not just the one in arm’s reach', () => {
  const { g, p, monsters } = fightAt(9, 'thief', 'ff', [[1, 0], [4, 0], [0, 5]]);
  p.power = 99;
  g.activateAbility('fatal-flurry');
  assert.equal(hurt(monsters), 3, 'a working that strikes every foe in sight left some of them standing');
});

test('and it does not need one of them adjacent before it will happen at all', () => {
  const { g, p, monsters } = fightAt(9, 'thief', 'ff-far', [[4, 0], [0, 5]]);
  p.power = 99;
  g.activateAbility('fatal-flurry');
  assert.equal(hurt(monsters), 2, 'foes in plain view were treated as no target at all');
  assert.ok(!g.logs.some((l) => /finds no target/.test(l)), 'refused a working that had two things to hit');
});

test('Whirlwind turns on the fighter, so distance from HIM is what counts', () => {
  /* One at his elbow, one two tiles off on the OTHER side of him, and one
   * across the room. The middle foe is the whole test: it stands well within
   * a dance centred on the man, and four tiles from the one at his elbow. A
   * circle drawn around the neighbour instead of around the fighter reaches
   * the first and misses the second, which is exactly what used to happen. */
  const { g, p, monsters } = fightAt(9, 'fighter', 'ww', [[1, 1], [-2, 0], [7, 0]]);
  p.power = 99;
  g.activateAbility('whirlwind');
  assert.ok(monsters[0].hp < monsters[0].maxhp, 'the foe at the fighter’s elbow went untouched');
  assert.ok(monsters[1].hp < monsters[1].maxhp, 'the dance was drawn around a monster, not around the man');
  assert.equal(monsters[2].hp, monsters[2].maxhp, 'the dance reached clear across the room');
});

test('Fireball still bursts where it lands, not where the mage stands', () => {
  /* The thrown shape is the one that was never broken: aim at the nearest in
   * reach, and let the burst catch what stands near IT — while a foe in plain
   * view but out of range stays out of it, which is what separates this from
   * the working that strikes the whole room. */
  const { g, p, monsters } = fightAt(9, 'mage', 'fb', [[4, 0], [5, 0], [0, 7]]);
  p.power = 99;
  g.activateAbility('fireball');
  assert.ok(monsters[0].hp < monsters[0].maxhp, 'the ball missed what it was aimed at');
  assert.ok(monsters[1].hp < monsters[1].maxhp, 'the burst spared a foe standing beside the target');
  assert.equal(monsters[2].hp, monsters[2].maxhp, 'the burst reached a foe seven tiles past its range');
});

test('a working with nothing to reach is still refused before it costs anything', () => {
  const { g, p } = fightAt(9, 'thief', 'ff-empty', []);
  p.power = 99;
  const power = p.power;
  g.activateAbility('fatal-flurry');
  assert.equal(p.power, power, 'an empty room still charged for the working');
  assert.equal(p.cooldowns['fatal-flurry'] || 0, 0, 'an empty room still put it on cooldown');
  assert.ok(g.logs.some((l) => /finds no target/.test(l)), 'said nothing about why nothing happened');
});

test('Judgment falls on every foe within five tiles, not on the nearest one', () => {
  const { g, p, monsters } = fightAt(9, 'cleric', 'jd', [[1, 0], [3, 1], [0, 5], [7, 0]]);
  p.power = 99;
  g.activateAbility('judgment');
  assert.equal(hurt(monsters.slice(0, 3)), 3, 'a five-tile blast spared foes standing inside it');
  assert.equal(monsters[3].hp, monsters[3].maxhp, 'and reached one seven tiles off');
});

test('but it does not scythe through a wall into the next room', () => {
  const { g, p, monsters } = fightAt(9, 'cleric', 'jd-dark', [[1, 0], [4, 0]]);
  p.power = 99;
  /* The far one stands well inside the radius and outside the light. */
  g.vis[monsters[1].y][monsters[1].x] = false;
  g.activateAbility('judgment');
  assert.ok(monsters[0].hp < monsters[0].maxhp, 'the foe in plain view went untouched');
  assert.equal(monsters[1].hp, monsters[1].maxhp, 'the blast found something it could not see');
});

test('what stands at a fighter’s elbow is lit by standing there', () => {
  /* Requiring light of a working that turns on the spot must not cost
   * Whirlwind the foe it is named for, so this one takes the floor's own
   * visibility rather than forcing it on. */
  const g = newGame('ww-lit', 'fighter');
  for (let i = 1; i < 9; i++) g.levelUp();
  g.loadFloor(0);
  const p = g.state.player;
  const m = { ...g.currentFloor.monsters.find((x) => x.hp > 0), x: p.x + 1, y: p.y, hp: 9999, maxhp: 9999, aggro: true };
  g.currentFloor.monsters = [m];
  g.computeVisibility();
  p.power = 99;
  g.activateAbility('whirlwind');
  assert.ok(m.hp < m.maxhp, 'the dance missed the foe it was touching');
});

/* WHAT THE RING ON THE GROUND PROMISES.
 *
 * The reach overlay is drawn from abilityReach, and the working is resolved
 * by damageTargets. If those two ever disagree the indicator is worse than no
 * indicator — it is a drawn promise the engine will not keep. These pin the
 * agreement, and in particular the METRIC, which is the half that is easy to
 * get wrong and impossible to notice: picking a target measures in king moves
 * and a blast measures in steps, so a ring drawn as the wrong one is a tile
 * and a half out on exactly the diagonals a player checks it on.
 */

test('a working with no ground reach offers nothing to draw', () => {
  for (const id of ['sharp-keen', 'ebb-flow', 'hide-shadows']) {
    const a = ABILITIES.find((x) => x.id === id);
    if (a) assert.equal(abilityReach(a), null, id + ' offered a ring it cannot draw');
  }
});

test('aiming measures in king moves, blasting and turning in steps', () => {
  const reach = (id) => abilityReach(ABILITIES.find((x) => x.id === id));
  assert.deepEqual(reach('firebolt'), { shape: 'aim', metric: 'chebyshev', radius: 7, blast: 0 });
  assert.deepEqual(reach('fireball'), { shape: 'aim', metric: 'chebyshev', radius: 5, blast: 3 });
  /* Whirlwind and Judgment turn on the spot and measure in steps. */
  assert.deepEqual(reach('whirlwind'), { shape: 'aura', metric: 'manhattan', radius: 2 });
  assert.deepEqual(reach('judgment'), { shape: 'aura', metric: 'manhattan', radius: 5 });
  assert.deepEqual(reach('turn-undead'), { shape: 'aura', metric: 'manhattan', radius: 6 });
  /* Fatal Flurry has no boundary but the light. */
  assert.deepEqual(reach('fatal-flurry'), { shape: 'sight' });
  /* And the twelfth level: a ward and a mending thrown over the company
   * reach ground too, so both draw a ring like anything else. */
  assert.deepEqual(reach('hold-the-line'), { shape: 'aura', metric: 'manhattan', radius: 2 });
  assert.deepEqual(reach('intercession'), { shape: 'aura', metric: 'manhattan', radius: 2 });
  assert.deepEqual(reach('rimebind'), { shape: 'aim', metric: 'chebyshev', radius: 5, blast: 2 });
  assert.deepEqual(reach('quiet-word'), { shape: 'aim', metric: 'chebyshev', radius: 1, blast: 0 });
});

test('the ring is drawn where the engine would actually reach', () => {
  /* The claim under the whole feature: every tile the ring encloses is one
   * the working can touch, and every tile outside it is one it cannot. */
  const cases = [
    ['fighter', 'whirlwind'],
    ['cleric', 'judgment'],
    ['mage', 'firebolt'],
  ];
  for (const [cls, id] of cases) {
    const a = ABILITIES.find((x) => x.id === id);
    const reach = abilityReach(a);
    const spots = [[1, 0], [0, 1], [2, 2], [3, 3], [4, 0], [5, 0], [6, 6], [0, 7]];
    const { g, p, monsters } = fightAt(9, cls, 'ring-' + id, spots);
    p.power = 999;
    const hit = new Set(g.damageTargets(a).map((m) => `${m.x},${m.y}`));
    for (const m of monsters) {
      const dx = Math.abs(m.x - p.x), dy = Math.abs(m.y - p.y);
      const d = reach.metric === 'manhattan' ? dx + dy : Math.max(dx, dy);
      const inside = d <= reach.radius;
      /* An aim-shaped working strikes ONE of the things inside its ring, so
       * the honest claim is one-directional: nothing outside is ever hit. */
      if (!inside) {
        assert.ok(!hit.has(`${m.x},${m.y}`),
          `${id}: struck a foe at ${dx},${dy} from outside the ring it draws`);
      } else if (reach.shape === 'aura') {
        assert.ok(hit.has(`${m.x},${m.y}`),
          `${id}: drew a ring over a foe at ${dx},${dy} and then spared it`);
      }
    }
  }
});

/* THE TWELFTH LEVEL.
 *
 * The last dungeon is tuned for levels 11-13 and the ladder stopped at nine,
 * so the approach to the Wyrm was bigger numbers and no new tools. These four
 * are each a verb their class did not have — protect, mend the company,
 * control, finish — and between them they add three fields the engine had
 * never seen: `party`, `stun` and `execute`.
 */

test('Hold the Line wards the company, not just the man who plants', () => {
  const { g, p } = fightAt(12, 'fighter', 'htl', [[1, 0]]);
  const mates = g.livingMembers().filter((m) => m !== p);
  mates.forEach((m, i) => { m.x = p.x + (i ? 2 : 1); m.y = p.y; });
  const far = mates[mates.length - 1];
  if (far) { far.x = p.x + 9; far.y = p.y; }
  p.power = 99;
  g.activateAbility('hold-the-line');
  assert.ok(p.buffs.ward > 0, 'the fighter did not ward himself');
  const near = g.livingMembers().filter((m) => m !== p && Math.abs(m.x - p.x) + Math.abs(m.y - p.y) <= 2);
  for (const m of near) assert.ok(m.buffs.ward > 0, m.name + ' stood beside him and got nothing');
  if (far && Math.abs(far.x - p.x) > 2) {
    assert.ok(!(far.buffs.ward > 0), 'the ward reached someone nine tiles away');
  }
});

test('and every warded member turns the same amount aside', () => {
  const { g, p } = fightAt(12, 'fighter', 'htl-amt', [[1, 0]]);
  const mate = g.livingMembers().find((m) => m !== p);
  if (!mate) return;
  mate.x = p.x + 1; mate.y = p.y;
  p.power = 99;
  g.activateAbility('hold-the-line');
  /* bonus 2, plus floor((12-1)/4) = 2, so four turned aside from each blow. */
  assert.equal(p.buffLevels.ward, 4);
  assert.equal(mate.buffLevels.ward, 4, 'the company wore a thinner ward than its captain');
});

test('Intercession mends everyone in reach, each to their own floor', () => {
  const { g, p } = fightAt(12, 'cleric', 'inter', [[1, 0]]);
  const mates = g.livingMembers().filter((m) => m !== p);
  mates.forEach((m, i) => { m.x = p.x + 1; m.y = p.y + i; });
  const far = mates[mates.length - 1];
  if (far) { far.x = p.x + 9; }
  for (const m of g.livingMembers()) m.hp = 1;
  p.power = 99;
  g.activateAbility('intercession');
  const near = g.livingMembers().filter((m) => Math.abs(m.x - p.x) + Math.abs(m.y - p.y) <= 2);
  for (const m of near) {
    assert.ok(m.hp >= Math.round(m.maxhp / 4), m.name + ' was left under their own quarter');
  }
  if (far && Math.abs(far.x - p.x) > 2) assert.equal(far.hp, 1, 'the answer carried nine tiles');
});

test('and it is refused, unspent, when nobody in reach is hurt', () => {
  const { g, p } = fightAt(12, 'cleric', 'inter-whole', [[1, 0]]);
  g.livingMembers().forEach((m) => { m.x = p.x; m.y = p.y; m.hp = m.maxhp; });
  p.power = 99;
  const power = p.power;
  g.activateAbility('intercession');
  assert.equal(p.power, power, 'a whole company still paid for the working');
  assert.equal(p.cooldowns['intercession'] || 0, 0, 'and it went on cooldown');
});

test('Rimebind holds what it catches still', () => {
  const { g, p, monsters } = fightAt(12, 'mage', 'rime', [[4, 0], [5, 0], [0, 9]]);
  p.power = 99;
  g.activateAbility('rimebind');
  assert.ok(monsters[0].stunned >= 2, 'the bloom did not hold what it was aimed at');
  assert.ok(monsters[1].stunned >= 2, 'a foe beside the target went unfrozen');
  assert.ok(!(monsters[2].stunned > 0), 'the cold reached nine tiles');
});

test('a frozen foe actually loses its turn', () => {
  /* monsterTakeTurn has read `stunned` since the Wand of Frost; this is the
   * first thing that sets it for longer than a heartbeat, so it is worth
   * checking the two ends meet. */
  const { g, p, monsters } = fightAt(12, 'mage', 'rime-turn', [[4, 0]]);
  p.power = 99;
  g.activateAbility('rimebind');
  const m = monsters[0];
  const before = m.stunned;
  const wasAt = { x: m.x, y: m.y };
  g.monsterTakeTurn(m);
  assert.equal(m.stunned, before - 1, 'the freeze did not count down on its turn');
  assert.deepEqual({ x: m.x, y: m.y }, wasAt, 'it moved while frozen');
});

test('The Quiet Word finishes a foe already down to a third', () => {
  const { g, p, monsters } = fightAt(12, 'thief', 'qw', [[1, 0]]);
  const m = monsters[0];
  m.maxhp = 120; m.hp = 30;            /* a quarter left: under the third */
  p.power = 99;
  g.activateAbility('quiet-word');
  assert.ok(m.hp <= 0, 'a foe on its last third walked away from the finish');
  assert.ok(!g.currentFloor.monsters.includes(m), 'it died and stayed on the floor');
});

test('but rolls honestly against one that is not', () => {
  const { g, p, monsters } = fightAt(12, 'thief', 'qw-high', [[1, 0]]);
  const m = monsters[0];
  m.maxhp = 120; m.hp = 119;           /* barely scratched */
  p.power = 99;
  g.activateAbility('quiet-word');
  assert.ok(m.hp > 0, 'a foe at full health was executed');
  assert.ok(m.hp < 119, 'and it took no damage either');
});

test('the Library cannot write itself a finisher, a freeze or a company ward', () => {
  const written = validateAbility({
    type: 'ability', cls: 'thief', name: 'Everything Dies', level: 12, kind: 'damage',
    powerCost: 1, cooldown: 1, range: 9, damage: { dice: 1, sides: 2, bonus: 0 },
    execute: 0.99, stun: 9, party: 9, sight: true,
  });
  for (const key of ['execute', 'stun', 'party', 'sight']) {
    assert.equal(written[key], undefined, 'the oracle was allowed to write ' + key);
  }
});
