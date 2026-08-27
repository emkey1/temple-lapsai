/* T4, THE ARCANUM TURN: backgrounds with a price, and skills wired to
 * systems that already exist. Every claim a background or a rank makes is
 * cashed here against the engine — a perk that changes no number is a lie
 * with a paragraph attached. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { Game, initialStats } from '../public/js/engine.js';
import { BACKGROUNDS, SKILLS, backgroundById } from '../public/js/base.js';
import { shopStock, sellPrice, identifyCost, hireMember, PRICES } from '../public/js/town.js';

function found(seed, cls, bg) {
  const logs = [];
  const g = new Game({ ui: { log: (m) => logs.push(m) } });
  g.state.seed = seed;
  g.foundAdventurer('Tester', cls, initialStats(cls), bg);
  g.logs = logs;
  return g;
}

test('every background trades something away, or admits to being nothing', () => {
  for (const bg of BACKGROUNDS) {
    if (bg.id === 'unremarked') continue;
    const gives = Object.values(bg.statAdj).some((v) => v > 0) || Object.keys(bg.perks).length;
    const costs = Object.values(bg.statAdj).some((v) => v < 0);
    assert.ok(gives, bg.name + ' gives nothing');
    assert.ok(costs, bg.name + ' costs nothing — that is a bonus, not a past');
  }
});

test('a background bakes its trade into the stats at the door', () => {
  const plain = found('t4-a', 'fighter');
  const orphan = found('t4-b', 'fighter', 'temple-orphan');
  assert.equal(orphan.state.player.stats.wis, plain.state.player.stats.wis + 1);
  assert.equal(orphan.state.player.stats.cha, plain.state.player.stats.cha - 1);
  assert.equal(orphan.state.player.background, 'temple-orphan');
});

test('perks ride derived for life: the lamplighter sees further', () => {
  const g = found('t4-sight', 'mage', 'lamplighter');
  assert.equal(g.derived().sight, 11, 'two extra tiles of lamplight');
  const plain = found('t4-sight2', 'mage');
  assert.equal(plain.derived().sight, 9);
});

test('a taught childhood is a free rank', () => {
  const g = found('t4-skill', 'thief', 'poachers-get');
  assert.equal(g.skillRank(g.state.player, 'fieldcraft'), 1);
});

test('a level teaches one thing, spendable and capped', () => {
  const g = found('t4-points', 'fighter');
  const p = g.state.player;
  assert.equal(p.skillPoints || 0, 0, 'level one has learned nothing yet');
  for (let i = 0; i < 5; i++) g.levelUp(p);
  assert.equal(p.skillPoints, 5);
  assert.ok(g.spendSkillPoint(p, 'haggle'));
  assert.equal(g.skillRank(p, 'haggle'), 1);
  assert.equal(p.skillPoints, 4);
  for (let i = 0; i < 3; i++) g.spendSkillPoint(p, 'haggle');
  assert.equal(g.skillRank(p, 'haggle'), 4, 'the ladder tops at four');
  assert.ok(!g.spendSkillPoint(p, 'haggle'), 'rank five was sold');
  assert.equal(p.skillPoints, 1, 'the refused rank still charged a point');
});

test('haggle bends every counter in town', () => {
  const g = found('t4-haggle', 'fighter');
  const p = g.state.player;
  const before = shopStock(g)[0].price;
  const feeBefore = identifyCost(g);
  const trinket = { name: 'A Gem', kind: 'misc', value: 40, identified: true };
  const sellBefore = sellPrice(trinket, g);
  p.skillPoints = 4;
  for (let i = 0; i < 4; i++) g.spendSkillPoint(p, 'haggle');
  assert.ok(shopStock(g)[0].price < before, 'buying never got cheaper');
  assert.ok(identifyCost(g) < feeBefore, 'the Lector never budged');
  assert.ok(sellPrice(trinket, g) > sellBefore, 'selling never got dearer');
});

test('mending closes wounds that resting alone cannot', () => {
  const g = found('t4-mend', 'cleric');
  const p = g.state.player;
  p.skillPoints = 2;
  g.spendSkillPoint(p, 'mending');
  g.spendSkillPoint(p, 'mending');
  p.wounds = 5;
  p.hp = Math.max(1, p.maxhp - 6);
  g.rest();
  assert.equal(p.wounds, 3, 'two ranks should close two wounds a sit-down');
});

test('a hireling arrives with a past and their learning unspent', () => {
  const g = newGame('t4-hire');
  const p = g.state.player;
  p.gold = 100000;
  for (let i = 0; i < 5; i++) g.levelUp(p);
  const b = hireMember(g, 'mage');
  assert.ok(backgroundById(b.background), 'a hireling with no story');
  assert.ok(b.skillPoints >= 5, 'their levels taught them nothing spendable');
});

test('an old save is owed the learning its levels earned', () => {
  const g = newGame('t4-legacy');
  for (let i = 0; i < 3; i++) g.levelUp(g.state.player);
  const save = JSON.parse(JSON.stringify(g.state));
  for (const m of save.party.members) { delete m.skills; delete m.skillPoints; }
  const g2 = newGame('t4-legacy2');
  g2.restore(save);
  assert.equal(g2.state.player.skillPoints, 3, 'three levels, three points owed');
});

/* ---- the caster's second curve ----
 *
 * A fighter's damage grows twice: the level step, and a better weapon off
 * the floor. A staff is a staff for ever, so at level six the mage's PAID
 * Firebolt matched the fighter's FREE swing. An INT-scaling attack gains a
 * die with practice — the mage's answer to the fighter's loot. */
import { newGame as freshGame } from './helpers.mjs';

test('a mage’s attack spells grow a die with practice', () => {
  const g = freshGame('caster-curve', 'mage');
  g.loadFloor(0);
  const p = g.state.player;
  const fb = g.allAbilities(p).find((a) => a.id === 'firebolt');
  assert.ok(fb, 'the mage has no Firebolt');
  assert.equal(g.casterDice(fb.damage).dice, 1, 'a novice should roll the printed die');
  while (p.level < 5) g.levelUp(p);
  assert.equal(g.casterDice(fb.damage).dice, 2, 'five levels of practice bought no second die');
  while (p.level < 10) g.levelUp(p);
  assert.equal(g.casterDice(fb.damage).dice, 3, 'ten levels bought no third');
});

test('an ability that costs power and a cooldown beats swinging for free', () => {
  /* The measurement that widened practice-scaling to every ability: at
   * level six a Backstab rolled 2-7 and a Shield Bash 2-7 while the same
   * character's FREE swing rolled 3-8 and 3-10. Paying power and a
   * cooldown to do LESS is not a choice worth offering. */
  for (const [cls, id] of [['thief', 'backstab'], ['fighter', 'shield-bash'], ['mage', 'firebolt']]) {
    for (const level of [6, 10]) {
      const g = freshGame('ability-worth-' + cls + level, cls);
      g.loadFloor(0);
      const p = g.state.player;
      while (p.level < level) g.levelUp(p);
      const a = g.allAbilities(p).find((x) => x.id === id);
      if (!a) continue;
      const der = g.derived();
      const d = g.casterDice(a.damage);
      const bonus = g.abilityBonus(a.damage, der);
      const best = (d.dice || 1) * (d.sides || 6) + bonus;
      const swingBest = (der.dmg.dice || 1) * (der.dmg.sides || 6) + (der.dmg.bonus || 0);
      assert.ok(best > swingBest,
        `${cls} L${level} ${a.name} tops out at ${best} against a free swing's ${swingBest}`);
    }
  }
});
