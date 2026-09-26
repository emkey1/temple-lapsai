/* Monster AI. The pair of rules under test — monsters route around walls, and
 * aggro eventually lapses — is what stops a woken monster holding the stairs
 * for the rest of the run. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H } from '../public/js/mapgen.js';
import { dist8 } from '../public/js/dice.js';
import { newGame } from './helpers.mjs';

/* Two rooms split by a wall with a single gap at the far south end. Reaching
 * the player means first walking away from them. */
function partitionedFloor(g) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 5; y < 20; y++) for (let x = 5; x < 40; x++) tiles[y][x] = T.FLOOR;
  for (let y = 5; y < 20; y++) tiles[y][20] = T.WALL;
  tiles[19][20] = T.FLOOR;
  g.currentFloor = {
    w: W, h: H, tiles, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 8, y: 7 }, down: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  g.state.player.x = 8;
  g.state.player.y = 7;
  g.state.player.hp = 9999;
  return g.currentFloor;
}

function beast(x, y, over = {}) {
  const t = {
    id: 't', name: 'Test Beast', glyph: 'B', color: 'red', tier: 1, hpMax: 99,
    ac: 10, toHit: 0, damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1,
    goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 40,
  };
  return {
    t, x, y, hp: 99, maxhp: 99, boss: false, aggro: true, acted: false,
    toHit: 0, dmg: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, ...over,
  };
}

test('a monster walks around a wall to reach the player', () => {
  const g = newGame('chase');
  const floor = partitionedFloor(g);
  const m = beast(35, 7);
  floor.monsters.push(m);
  for (let t = 0; t < 200 && dist8(m, g.state.player) > 1; t++) {
    g.turn = t;
    g.resolveMonsters();
  }
  assert.ok(dist8(m, g.state.player) <= 1, `monster stalled at (${m.x},${m.y})`);
});

test('a monster that cannot see or reach the player gives up', () => {
  const g = newGame('aggro');
  const floor = partitionedFloor(g);
  /* Sealed in its own pocket, with no route to the player at all. */
  for (let y = 24; y < 28; y++) for (let x = 24; x < 28; x++) floor.tiles[y][x] = T.FLOOR;
  const m = beast(25, 25);
  floor.monsters.push(m);
  g.vis = Array.from({ length: H }, () => Array(W).fill(false));
  for (let t = 0; t < 40; t++) {
    g.turn = t;
    g.resolveMonsters();
  }
  assert.equal(m.aggro, false, 'a walled-off monster stayed on alert forever');
});

test('a monster in plain sight stays on alert', () => {
  const g = newGame('alert');
  const floor = partitionedFloor(g);
  const m = beast(12, 7);
  floor.monsters.push(m);
  for (let t = 0; t < 40 && dist8(m, g.state.player) > 1; t++) {
    g.turn = t;
    g.resolveMonsters();
  }
  assert.equal(m.aggro, true, 'a visible monster lost interest');
});

test('the stairs are only barred by something at your heels', () => {
  const g = newGame('stairs');
  const floor = partitionedFloor(g);
  const p = g.state.player;
  floor.tiles[p.y][p.x] = T.DOWN;
  floor.monsters.push(beast(35, 18));   /* awake, aggro'd, far away */
  const before = p.floorIdx;
  g.stepOn(p.x, p.y);
  assert.notEqual(p.floorIdx, before, 'a distant monster blocked the descent');
});

test('a monster at your heels does bar the stairs', () => {
  const g = newGame('stairs-near');
  const floor = partitionedFloor(g);
  const p = g.state.player;
  floor.tiles[p.y][p.x] = T.DOWN;
  floor.monsters.push(beast(p.x + 1, p.y));
  const before = p.floorIdx;
  g.stepOn(p.x, p.y);
  assert.equal(p.floorIdx, before, 'walked downstairs with a monster adjacent');
});

/* ---- what a monster did with its turn ----
 *
 * The turn loop used to work out whether a monster had attacked by watching
 * whether it had MOVED — which reads a missed swing and a blocked corridor as
 * the same event, and is the first thing to break once a creature can strike
 * more than once in a turn. monsterAct says what it did.
 */

/* An open room with the player at one end, so distances are what they look. */
function arena(g) {
  partitionedFloor(g);
  for (let y = 5; y < 20; y++) g.currentFloor.tiles[y][20] = T.FLOOR;
  return g.currentFloor;
}

test('a monster in reach strikes, and says so', () => {
  const g = newGame('act-strike');
  const floor = arena(g);
  const p = g.state.player;
  const m = beast(p.x + 1, p.y);
  floor.monsters = [m];
  assert.equal(g.monsterAct(m, true, g.derived(), g.playerDistanceField()), 'strike');
});

test('a missed swing is still a strike, not a monster standing still', () => {
  const g = newGame('act-miss');
  const floor = arena(g);
  const p = g.state.player;
  const m = beast(p.x + 1, p.y);
  floor.monsters = [m];
  m.toHit = -100;          /* it cannot possibly land */
  const before = { x: m.x, y: m.y };
  const did = g.monsterAct(m, true, g.derived(), g.playerDistanceField());
  assert.equal(did, 'strike', 'a miss read as "did nothing"');
  assert.deepEqual({ x: m.x, y: m.y }, before);
});

test('a monster with somewhere to go steps, and one hemmed in does nothing', () => {
  const g = newGame('act-step');
  const floor = arena(g);
  const p = g.state.player;
  const m = beast(p.x + 4, p.y);
  floor.monsters = [m];
  assert.equal(g.monsterAct(m, true, g.derived(), g.playerDistanceField()), 'step');

  /* Wall it in on every side and it has nothing to do. */
  const boxed = beast(p.x + 8, p.y + 5);
  floor.monsters = [boxed];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.currentFloor.tiles[boxed.y + dy][boxed.x + dx] = T.WALL;
  }
  assert.equal(g.monsterAct(boxed, true, g.derived(), g.playerDistanceField()), 'nothing');
});

test('speed buys ground and never a second blow', () => {
  /* A fast thing closes sooner. It does not get to strike twice, and the loop
   * that grants it its extra steps has to stop the moment it swings. */
  const g = newGame('act-speed');
  const floor = arena(g);
  const p = g.state.player;
  p.hp = 500;
  const hp = p.hp;
  const m = beast(p.x + 1, p.y);
  m.t = { ...m.t, speed: 4 };
  m.toHit = 100;           /* it cannot possibly miss */
  m.revealed = true; m.lastSeen = g.turn;
  floor.monsters = [m];
  g.logs.length = 0;
  g.resolveMonsters();
  /* Counted off the log rather than off the damage: rollDamage floors the die
   * at a d2, so one blow can take two hit points and arithmetic cannot tell
   * one blow from two. */
  const blows = g.logs.filter((l) => /hits you for/.test(l)).length;
  assert.equal(blows, 1, `a speed 4 monster landed ${blows} blows in one turn`);
  assert.ok(hp - p.hp > 0, 'it did not attack at all');
});

test('a bleed keeps cutting on the thing\'s own turn, and can finish it', () => {
  const g = newGame('bleed');
  const floor = partitionedFloor(g);
  const m = beast(12, 7, { hp: 5, maxhp: 5, bleed: 3, bleedDmg: 3 });
  floor.monsters.push(m);
  g.turn = 0;
  g.resolveMonsters();
  assert.equal(m.hp, 2, 'the bleed did not tick at the start of the turn');
  assert.equal(m.bleed, 2, 'the bleed did not count down');
  g.turn = 1;
  g.resolveMonsters();
  assert.ok(m.hp <= 0, 'a bleed could not finish something it had already cut');
});
