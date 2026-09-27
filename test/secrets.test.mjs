/* Secret doors. They used to be walk-through-able — isTravelable() listed them
 * as open ground — and one bump from a thief revealed every secret on the
 * floor. Searching is now local, and a secret is a wall until you find it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H, isTravelable } from '../public/js/mapgen.js';
import { newGame } from './helpers.mjs';

/* A room, a wall with one secret door in it, and the player beside the door. */
function secretFloor(g) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 5; y < 15; y++) for (let x = 5; x < 25; x++) tiles[y][x] = T.FLOOR;
  tiles[10][15] = T.SECRET;
  g.currentFloor = {
    w: W, h: H, tiles, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 8, y: 10 }, down: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  g.state.player.x = 14;
  g.state.player.y = 10;
  return g.currentFloor;
}

test('a secret door is solid until it is found', () => {
  assert.equal(isTravelable(T.SECRET), false, 'secret doors count as open ground');
});

test('walking into a secret door does not walk through it', () => {
  const g = newGame('secret-solid');
  const floor = secretFloor(g);
  const p = g.state.player;
  g.tryMove(1, 0);
  assert.ok(p.x === 14 || floor.tiles[10][15] === T.DOOR_O,
    'the player passed through an unfound secret door');
});

test('searching eventually finds the door in front of you', () => {
  const g = newGame('secret-find');
  const floor = secretFloor(g);
  for (let t = 0; t < 60 && floor.tiles[10][15] === T.SECRET; t++) {
    g.turn = t;
    g.tryMove(1, 0);
  }
  assert.equal(floor.tiles[10][15], T.DOOR_O, 'sixty attempts failed to find one door');
});

test('the F key searches every wall in reach, and spends the turn', () => {
  const g = newGame('secret-searchkey');
  const floor = secretFloor(g);
  let turns = 0;
  for (let t = 0; t < 80 && floor.tiles[10][15] === T.SECRET; t++) {
    g.turn = t;
    if (g.handleKey('f')) turns++;
  }
  assert.equal(floor.tiles[10][15], T.DOOR_O, 'searching the ring never found the door beside us');
  assert.ok(turns > 0, 'the search never spent a turn');
});

test('searching plain stone costs nothing and finds nothing', () => {
  const g = newGame('secret-empty');
  const floor = secretFloor(g);
  g.state.player.x = 10;
  g.state.player.y = 10;   /* no secret anywhere near */
  assert.equal(g.handleKey('f'), false, 'a search of plain stone cost a turn');
  assert.equal(floor.tiles[10][15], T.SECRET, 'plain stone opened a door');
});

test('finding one door does not reveal every other secret on the floor', () => {
  const g = newGame('secret-local');
  const floor = secretFloor(g);
  floor.tiles[12][20] = T.SECRET;    /* a second one, far from the player */
  for (let t = 0; t < 60 && floor.tiles[10][15] === T.SECRET; t++) {
    g.turn = t;
    g.tryMove(1, 0);
  }
  assert.equal(floor.tiles[10][15], T.DOOR_O, 'never found the near door');
  assert.equal(floor.tiles[12][20], T.SECRET, 'a distant secret opened by itself');
});

test('True Seeing finds the door on the first touch', () => {
  const g = newGame('secret-amulet');
  const floor = secretFloor(g);
  g.state.player.equipment.amulet = { name: 'Amulet of True Seeing', kind: 'amulet', slot: 'amulet', effects: { seeSecrets: true } };
  g.tryMove(1, 0);
  assert.equal(floor.tiles[10][15], T.DOOR_O, 'True Seeing did not reveal the door it touched');
});

test('a found door stays found after leaving and returning', () => {
  const g = newGame('secret-memo');
  g.loadFloor(0);
  const floor = g.currentFloor;
  let spot = null;
  for (let y = 0; y < H && !spot; y++) {
    for (let x = 0; x < W; x++) if (floor.tiles[y][x] === T.SECRET) { spot = { x, y }; break; }
  }
  if (!spot) return;                 /* this seed produced no secret doors */
  g.revealSecretAt(spot.x, spot.y);
  g.loadFloor(1);
  g.loadFloor(0);
  assert.equal(g.currentFloor.tiles[spot.y][spot.x], T.DOOR_O, 'the door hid itself again');
});

/* THE ONE SECRET THAT MUST NOT BE MISSABLE.
 *
 * Every last floor puts its boss behind a hidden door in the same fixed
 * place: the west wall of the den frame, one step off the lane back to the
 * stairs. Everything else a secret gates is optional — the cache is loot, and
 * missing loot costs a shrug. That one gates the boss, and behind the boss is
 * the quest, the next dungeon and the end of the run. The playtest walked the
 * fourth floor of the third dungeon and could not get in.
 */

import { DUNGEONS, getMonster } from '../public/js/base.js';

function lastFloorOf(id, seed = 'den') {
  const g = newGame(seed);
  const d = DUNGEONS.find((x) => x.id === id);
  g.enterDungeon(id);
  g.loadFloor(d.floors - 1);
  return { g, d, floor: g.currentFloor };
}

test('every dungeon puts its boss behind that one door', () => {
  for (const d of DUNGEONS) {
    const { floor } = lastFloorOf(d.id);
    assert.ok(floor.den, d.id + ' has no den on its last floor');
    const x = floor.den.x - 1, y = floor.den.y + Math.floor(floor.den.h / 2);
    assert.ok(floor.tiles[y][x] === T.DOOR_O || floor.tiles[y][x] === T.SECRET,
      d.id + ': the den door is neither hidden nor a door');
    assert.ok((floor.monsters || []).some((m) => m.boss), d.id + ' placed no boss');
  }
});

test('and the company hears it through the wall before it can walk past', () => {
  for (const d of DUNGEONS) {
    const { g, floor } = lastFloorOf(d.id, 'hear-' + d.id);
    const x = floor.den.x - 1, y = floor.den.y + Math.floor(floor.den.h / 2);
    if (floor.tiles[y][x] !== T.SECRET) continue;   /* already open, nothing to prove */
    /* The lane runs one column west of the door; stand on it, two north. */
    const p = g.state.player;
    p.x = x - 1; p.y = y - 2;
    g.computeVisibility();
    assert.equal(floor.tiles[y][x], T.DOOR_O,
      d.id + ': walked within two tiles of the only way in and heard nothing');
  }
});

test('but a hidden cache keeps its secret, because missing loot is only a shrug', () => {
  const { g, floor } = lastFloorOf('temple', 'cache-quiet');
  if (!floor.cache) return;
  const walls = [];
  for (let y = floor.cache.y - 1; y <= floor.cache.y + floor.cache.h; y++) {
    for (let x = floor.cache.x - 1; x <= floor.cache.x + floor.cache.w; x++) {
      if (floor.tiles[y] && floor.tiles[y][x] === T.SECRET) walls.push({ x, y });
    }
  }
  if (!walls.length) return;
  const p = g.state.player;
  p.x = walls[0].x - 1; p.y = walls[0].y;
  g.computeVisibility();
  assert.equal(floor.tiles[walls[0].y][walls[0].x], T.SECRET,
    'standing beside a cache gave its door away — the rule was meant to be narrow');
});
