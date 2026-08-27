/* The wayfinder, proven on hand-drawn floors. Each map is a string picture:
 * '#' wall, '.' floor, '~' water, '+' closed door, '?' a tile never seen,
 * 'A' start, 'B' destination. The pictures keep the tests honest — a reader
 * can see the room the assertion argues about. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../public/js/path.js';
import { T } from '../public/js/mapgen.js';

function world(picture) {
  const rows = picture.trim().split('\n').map((r) => r.trim());
  const tiles = [], seen = [];
  let from = null, to = null;
  const MAP = { '#': T.WALL, '.': T.FLOOR, '~': T.WATER, '+': T.DOOR_C, '?': T.FLOOR, '>': T.DOWN, '<': T.UP };
  rows.forEach((row, y) => {
    tiles.push([]); seen.push([]);
    [...row].forEach((ch, x) => {
      if (ch === 'A') { from = { x, y }; ch = '.'; }
      if (ch === 'B') { to = { x, y }; ch = '.'; }
      tiles[y].push(MAP[ch] ?? T.FLOOR);
      seen[y].push(ch !== '?');
    });
  });
  return { tiles, seen, from, to };
}

const run = (picture, blocked) => {
  const w = world(picture);
  return findPath({ ...w, blocked });
};

test('a straight corridor walks straight', () => {
  const path = run(`
    #####
    #A.B#
    #####
  `);
  assert.deepEqual(path, [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
});

test('a wall forces the detour', () => {
  const path = run(`
    #####
    #A#B#
    #...#
    #####
  `);
  assert.ok(path, 'no route found around the wall');
  assert.equal(path.at(-1).x, 3);
  assert.equal(path.at(-1).y, 1);
  assert.ok(path.some((s) => s.y === 2), 'the route never dropped into the open row');
});

test('the dark is a wall: unseen tiles are not pathed through', () => {
  const path = run(`
    #####
    #A?B#
    #####
  `);
  assert.equal(path, null);
});

test('dry corridor beats the drowned shortcut', () => {
  /* Two rooms joined by one tile of water, and by a dry hallway three steps
   * longer. Wading is slow and loud; the route must take the hall. */
  const path = run(`
    #######
    #A~B..#
    #.....#
    #######
  `);
  assert.ok(path, 'no route at all');
  assert.ok(!path.some((s) => s.x === 2 && s.y === 1), 'the route wades when it could walk');
});

test('water is still a road when it is the only one', () => {
  const path = run(`
    #####
    #A~B#
    #####
  `);
  assert.ok(path, 'refused a crossable river');
  assert.ok(path.some((s) => s.x === 2 && s.y === 1));
});

test('a closed door is one bump, not a wall', () => {
  const path = run(`
    #####
    #A+B#
    #####
  `);
  assert.ok(path, 'a door stopped the route');
  assert.equal(path.length, 2);
});

test('no slipping between two wall corners', () => {
  const path = run(`
    ####
    #A##
    ##B#
    ####
  `);
  assert.equal(path, null, 'the route squeezed through a sealed corner');
});

test('something standing in the way is walked around, not through', () => {
  const w = world(`
    #####
    #A.B#
    #...#
    #####
  `);
  const path = findPath({ ...w, blocked: new Set(['2,1']) });
  assert.ok(path, 'a single body sealed a two-row room');
  assert.ok(!path.some((s) => s.x === 2 && s.y === 1), 'walked through the body');
});

test('the destination may be a body, because that is what attacking is', () => {
  const w = world(`
    #####
    #A.B#
    #####
  `);
  const path = findPath({ ...w, blocked: new Set(['3,1']) });
  assert.ok(path, 'could not walk at the monster');
  assert.deepEqual(path.at(-1), { x: 3, y: 1 });
});

test('an unreachable room is answered with null, not a guess', () => {
  const path = run(`
    ######
    #A##B#
    ######
  `);
  assert.equal(path, null);
});

test('clicking where you stand asks for nothing', () => {
  const w = world(`
    ###
    #A#
    ###
  `);
  assert.deepEqual(findPath({ ...w, to: w.from }), []);
});

/* ---- stairs are destinations, not waypoints ----
 *
 * Reported: a party crossing a staircase on the way to somewhere else was
 * whisked down a floor mid-walk. `soft` tiles are avoided while any other
 * route exists, and crossed only when the stair is a chokepoint. */
test('a route walks around the stairs when it can', () => {
  const w = world(`
    #######
    #A.>.B#
    #.....#
    #######
  `);
  const soft = new Set();
  w.tiles.forEach((row, y) => row.forEach((t, x) => { if (t === T.UP || t === T.DOWN) soft.add(x + ',' + y); }));
  const path = findPath({ ...w, soft });
  assert.ok(path, 'no route at all');
  assert.ok(!path.some((s) => soft.has(s.x + ',' + s.y)), 'the route marched over the staircase');
});

test('a stair in a chokepoint is crossed rather than walling the floor off', () => {
  const w = world(`
    #######
    #A.>.B#
    #######
  `);
  const soft = new Set();
  w.tiles.forEach((row, y) => row.forEach((t, x) => { if (t === T.UP || t === T.DOWN) soft.add(x + ',' + y); }));
  const path = findPath({ ...w, soft });
  assert.ok(path, 'the chokepoint stair walled off the east half');
  assert.ok(path.some((s) => soft.has(s.x + ',' + s.y)), 'somehow crossed without the stair');
});

test('a stair can still be the destination itself', () => {
  const w = world(`
    #####
    #A.>#
    #####
  `);
  let stair = null;
  w.tiles.forEach((row, y) => row.forEach((t, x) => { if (t === T.DOWN) stair = { x, y }; }));
  const soft = new Set([stair.x + ',' + stair.y]);
  const path = findPath({ ...w, to: stair, soft });
  assert.ok(path && path.length, 'the stair refused its own click');
  const last = path[path.length - 1];
  assert.deepEqual({ x: last.x, y: last.y }, stair);
});
