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
