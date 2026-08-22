/* Regressions from an adversarial review of the Phase 3/4 work. Each of these
 * was a confirmed defect — some newly introduced, some pre-existing and only
 * surfaced once the surrounding code started being used. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H } from '../public/js/mapgen.js';
import { dist1 } from '../public/js/dice.js';
import { CLASSES } from '../public/js/base.js';
import { RNG } from '../public/js/rng.js';
import { newGame, floorOf } from './helpers.mjs';

function arena(g) {
  const grid = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 5; y < 18; y++) for (let x = 5; x < 30; x++) grid[y][x] = T.FLOOR;
  g.currentFloor = {
    w: W, h: H, tiles: grid, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 8, y: 10 }, down: null, altar: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  g.state.player.x = 10;
  g.state.player.y = 10;
  return g.currentFloor;
}

function beast(x, y, over = {}) {
  const t = {
    id: 't', name: 'Beast', glyph: 'B', color: 'red', tier: 1, hpMax: 40, ac: 10,
    toHit: 0, damage: { dice: 1, sides: 4, bonus: 0 }, xp: 5, goldMin: 0, goldMax: 0,
    props: [], speed: 1, aggroRange: 30, ...(over.t || {}),
  };
  return {
    t, x, y, hp: over.hp ?? 40, maxhp: 40, boss: false, aggro: true, acted: false,
    toHit: over.toHit ?? 0, dmg: { dice: 1, sides: 4, bonus: 0 }, xp: 5,
    goldMin: 0, goldMax: 0, idx: x * 100 + y, ...over,
  };
}

/* ---- combat maths ---- */

test('a blow that lands never heals what it hit', () => {
  /* The Mage's -1 damage bonus against a 1-point roll went negative. */
  const g = newGame('floor-dmg', 'mage');
  arena(g);
  for (let t = 0; t < 200; t++) {
    g.turn = t;
    assert.ok(g.rollDamage({ dice: 1, sides: 2, bonus: -5 }) >= 1, 'damage went to zero or below');
  }
});

test('the class damage bonus survives picking up a weapon', () => {
  const g = newGame('class-dmg');
  const p = g.state.player;
  const c = CLASSES[p.cls];
  assert.ok(c.dmgBonus > 0, 'this class has no bonus to lose');
  const armed = g.derived().dmg.bonus;
  p.equipment.weapon = null;
  const unarmed = g.derived().dmg.bonus;
  assert.ok(armed >= unarmed, `equipping a weapon dropped the class bonus: ${armed} < ${unarmed}`);
});

test('borrowed strength works even at the stat cap', () => {
  const g = newGame('str-cap');
  arena(g);
  const p = g.state.player;
  p.stats.str = 18;
  const before = g.derived();
  p.buffs.str = 10;
  const after = g.derived();
  assert.ok(after.effValues.str > before.effValues.str, 'the 18 cap ate the whole potion');
  assert.ok(after.dmg.bonus > before.dmg.bonus, 'and it never reached the damage roll');
});

test('abilities scale on effective stats, not the bare sheet', () => {
  const g = newGame('ability-stats');
  arena(g);
  const p = g.state.player;
  p.stats.str = 10;
  const plain = g.abilityBonus({ n: 'str' }, g.derived());
  p.equipment.ring = { name: 'Ring of Might', kind: 'ring', slot: 'ring', effects: { statBonus: { str: 4 } } };
  const ringed = g.abilityBonus({ n: 'str' }, g.derived());
  assert.ok(ringed > plain, 'a Ring of Might is invisible to every STR ability');
});

test('a monster can always land a natural twenty', () => {
  /* Enough armour used to put the player permanently out of reach. */
  const g = newGame('nat20');
  arena(g);
  const p = g.state.player;
  p.hp = 9999; p.maxhp = 9999;
  p.equipment.body = { name: 'Impossible Plate', kind: 'armor', slot: 'body', effects: { acBonus: 40 } };
  const m = beast(11, 10, { toHit: -50 });
  g.currentFloor.monsters.push(m);
  let hits = 0;
  for (let t = 0; t < 300; t++) { g.turn = t; g.logs.length = 0; g.monsterMelee(m); if (/hits you/.test(g.logs.join(' '))) hits++; }
  assert.ok(hits > 0, 'a monster could never touch the player, however long it tried');
});

/* ---- the turn loop ---- */

test('Cleave cannot be spent walking away', () => {
  /* Granting a free ACTION let the player cash a kill in as a free disengage.
   * It is a bonus attack, resolved on the spot. */
  const g = newGame('cleave-step');
  arena(g);
  g.currentFloor.monsters.push(beast(11, 10, { hp: 1, t: { ac: 30 } }));
  let ended = 0;
  const real = g.endPlayerTurn.bind(g);
  g.endPlayerTurn = () => { ended++; real(); };
  g.handleKey('d');                       /* the killing blow */
  assert.equal(ended, 1, 'the turn did not end, leaving a free action to spend');
});

test('speed buys ground, not extra blows', () => {
  const g = newGame('speed-blows');
  arena(g);
  const p = g.state.player;
  p.hp = 999; p.maxhp = 999;
  const m = beast(11, 10, { t: { speed: 4, ac: 10 }, toHit: 60 });
  g.currentFloor.monsters.push(m);
  g.turn = 1;
  g.logs.length = 0;
  g.resolveMonsters();
  const blows = g.logs.filter((l) => /hits you for/.test(l)).length;
  assert.equal(blows, 1, `a speed-4 monster struck ${blows} times in one turn`);
});

test('a fast monster two tiles away still gets to attack', () => {
  const g = newGame('speed-close');
  arena(g);
  const p = g.state.player;
  p.hp = 999; p.maxhp = 999;
  const m = beast(12, 10, { t: { speed: 2, ac: 10 }, toHit: 60 });
  g.currentFloor.monsters.push(m);
  g.turn = 1;
  g.logs.length = 0;
  g.resolveMonsters();
  assert.match(g.logs.join(' '), /hits you for|lashes out/, 'it closed the gap and then stood there');
});

test('a fast ranged monster shoots once a turn', () => {
  const g = newGame('speed-ranged');
  arena(g);
  const p = g.state.player;
  p.hp = 999; p.maxhp = 999;
  const m = beast(16, 10, { t: { speed: 4, props: ['ranged'], ac: 10 }, toHit: 60 });
  g.currentFloor.monsters.push(m);
  g.turn = 1;
  g.logs.length = 0;
  g.resolveMonsters();
  const shots = g.logs.filter((l) => /looses at you/.test(l)).length;
  assert.ok(shots <= 1, `a speed-4 archer loosed ${shots} times in one turn`);
});

test('per-turn flags do not survive a death', () => {
  const g = newGame('death-flags');
  arena(g);
  g.wading = true;
  g.pendingCleave = true;
  g.cleavedThisTurn = true;
  g.die(beast(11, 10));
  assert.equal(g.wading, false, 'wading leaked past the grave');
  assert.equal(g.cleavedThisTurn, false, 'the cleave allowance leaked past the grave');
});

test('Turn Undead wears off', () => {
  /* p.buffs floors at 0, so `buffs.turn && buffs.turn <= 0` never fired. */
  const g = newGame('turn-expire');
  arena(g);
  const p = g.state.player;
  p.buffs.turn = 2;
  for (let t = 0; t < 6; t++) { g.turn = t; g.tickStatus(); }
  assert.equal(p.buffs.turn, undefined, 'Turn Undead never expired and stayed in the save forever');
});

test('sanctuary breaks when you draw blood', () => {
  const g = newGame('sanct-break');
  arena(g);
  const p = g.state.player;
  p.buffs.sanctuary = 12;
  const m = beast(11, 10);
  g.currentFloor.monsters.push(m);
  g.attackMonster(m);
  assert.equal(p.buffs.sanctuary, undefined, 'sanctuary survived the player attacking from inside it');
});

/* ---- floor generation ---- */

test('placing an altar does not move the monsters', () => {
  /* Any rng draw shifts the stream. Taking one before the roster is placed
   * would silently invalidate the floor memories in existing saves. */
  const a = floorOf('temple', 1, 'stream').floor;
  const b = floorOf('temple', 1, 'stream').floor;
  const sig = (f) => JSON.stringify(f.monsters.map((m) => [m.idx, m.x, m.y, m.t.id]));
  assert.equal(sig(a), sig(b));
  assert.ok(a.altar, 'no altar placed');
  assert.equal(a.tiles[a.altar.y][a.altar.x], T.ALTAR);
});

test('the deepest loot table can actually drop', () => {
  /* floor(floorIdx / 1.5) capped at 2 with only four floors, so the table
   * holding the Deep Ward, True Seeing, the Lucky Coin and Sanctuary — three
   * of the effects this work wired up — was unreachable. */
  const g = newGame('deep-loot');
  g.state.player.dungeonId = 'temple';
  const wanted = ['Ward', 'Seeing', 'Coin', 'Sanctuary'];
  const found = new Set();
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s < 300; s++) {
      const it = g.pickItem(f, new RNG(`deep-${f}-${s}`));
      if (!it) continue;
      for (const w of wanted) if (it.name.includes(w)) found.add(w);
    }
  }
  assert.ok(found.size >= 3, `only ${[...found].join(', ') || 'nothing'} from the deepest table can ever drop`);
});

/* ---- items and the belt ---- */

test('a wand in the pack is labelled by what it will do', () => {
  /* useItem checks kind before slot, so a wand fires rather than being worn —
   * under a button that said WEAR. */
  const g = newGame('wand-verb');
  arena(g);
  const p = g.state.player;
  const wand = { name: 'Wand of Fire', kind: 'wand', slot: 'weapon', uid: 'w1', effects: { spell: 'firebolt', charges: 5 } };
  p.inventory.push(wand);
  g.currentFloor.monsters.push(beast(12, 10));
  g.logs.length = 0;
  g.useItem(wand);
  assert.match(g.logs.join(' '), /wand of firebolt|lances|spent|fizzles/i, 'a wand did not behave as a wand');
});

test('an altar at full strength keeps its charge', () => {
  const g = newGame('altar-waste');
  g.loadFloor(0);
  const { x, y } = g.currentFloor.altar;
  const p = g.state.player;
  p.hp = p.maxhp;
  p.power = p.maxpower;
  g.logs.length = 0;
  g.useAltar(x, y);
  assert.match(g.logs.join(' '), /nothing to ask it for/i);
  p.hp = 1;
  g.useAltar(x, y);
  assert.ok(p.hp > 1, 'the altar was spent by someone who needed nothing');
});
