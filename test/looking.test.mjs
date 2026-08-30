/* Looking around. The controls were previously discoverable only from the
 * README, so these messages are the game teaching its own keys. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T } from '../public/js/mapgen.js';
import { newGame } from './helpers.mjs';

function withItemUnderfoot(g, name = 'Dagger', kind = 'weapon') {
  const p = g.state.player;
  g.currentFloor.items.push({ i: { name, kind, slot: 'weapon', glyph: 'd', color: 'white', value: 5, effects: {} }, x: p.x, y: p.y, auto: false });
}

test('stepping onto loot says what it is and which key takes it', () => {
  const g = newGame('underfoot');
  const p = g.state.player;
  g.currentFloor.tiles[p.y][p.x] = T.FLOOR;   /* off the stairs, on plain ground */
  g.logs.length = 0;
  withItemUnderfoot(g);
  g.stepOn(p.x, p.y);
  const said = g.logs.join(' ');
  assert.match(said, /Underfoot: Dagger/);
  assert.match(said, /Press G/);
});

test('G with nothing there describes the ground instead of staying silent', () => {
  const g = newGame('look');
  const p = g.state.player;
  g.currentFloor.tiles[p.y][p.x] = T.FLOOR;
  g.logs.length = 0;
  g.handleKey('g');
  assert.match(g.logs.join(' '), /nothing to take here/i);
});

test('G on the stairs says what the stairs do', () => {
  const g = newGame('look-stairs');
  const p = g.state.player;
  assert.equal(g.currentFloor.tiles[p.y][p.x], T.UP);
  g.logs.length = 0;
  g.handleKey('g');
  assert.match(g.logs.join(' '), /stair up/i);
});

test('G still picks loot up when there is loot to pick up', () => {
  const g = newGame('take');
  const p = g.state.player;
  withItemUnderfoot(g);
  const before = p.inventory.length;
  g.handleKey('g');
  assert.equal(p.inventory.length, before + 1);
  assert.equal(p.inventory[before].name, 'Dagger');
});

test('looking around names loot within a few tiles and the way to it', () => {
  const g = newGame('nearby');
  const p = g.state.player;
  g.currentFloor.items.push({ i: { name: 'Gemstone', kind: 'special', glyph: 'X', color: 'cyan', value: 40, effects: {} }, x: p.x + 2, y: p.y, auto: true });
  g.computeVisibility();
  g.logs.length = 0;
  g.handleKey('g');
  const said = g.logs.join(' ');
  assert.match(said, /Within reach/);
  assert.match(said, /Gemstone to the east/);
});

/* KNOWN, AND KNOWN BY HAVING BEEN THERE.
 *
 * A chart draws the whole floor, and once it had there was no way to tell the
 * drawn part from the walked part — "impossible to know where you have been",
 * which for a floor you are halfway through is the entire use of a map. So a
 * third state: charted, meaning known but not stood on. It is kept apart from
 * `seen` rather than folded into it, because every read of seen in the game is
 * a truthiness test and widening it would have meant auditing all of them.
 */

import { getItemTemplate } from '../public/js/base.js';
import { deepItem } from '../public/js/dice.js';

function chartedGame(seed = 'chart') {
  const g = newGame(seed);
  g.loadFloor(0);
  const scroll = deepItem(getItemTemplate('scroll-reveal'));
  g.state.player.inventory.push(scroll);
  g.useItem(scroll);
  return g;
}

const count = (grid) => grid.flat().filter(Boolean).length;

test('reading the chart marks what it drew as known-not-walked', () => {
  const g = chartedGame();
  assert.ok(count(g.charted) > 0, 'the chart drew nothing it called hearsay');
  /* Everything charted is also seen — it is on the map — but not the reverse. */
  for (let y = 0; y < g.charted.length; y++) {
    for (let x = 0; x < g.charted[y].length; x++) {
      if (g.charted[y][x]) assert.ok(g.seen[y][x], `charted ${x},${y} was not marked seen`);
    }
  }
});

test('and the ground the party was already standing on is not hearsay', () => {
  const g = chartedGame('chart-here');
  const p = g.state.player;
  assert.equal(g.charted[p.y][p.x], false, 'the tile underfoot was called hearsay');
});

test('laying eyes on charted ground settles it', () => {
  const g = chartedGame('chart-walk');
  const p = g.state.player;
  let target = null;
  for (let y = 0; y < g.charted.length && !target; y++) {
    for (let x = 0; x < g.charted[y].length; x++) {
      if (g.charted[y][x] && g.currentFloor.tiles[y][x] === T.FLOOR) { target = { x, y }; break; }
    }
  }
  assert.ok(target, 'the chart drew no floor at all');
  const before = count(g.charted);
  g.state.party.members.forEach((m) => { m.x = target.x; m.y = target.y; });
  g.computeVisibility();
  assert.equal(g.charted[target.y][target.x], false, 'stood on it and it stayed hearsay');
  assert.ok(g.seen[target.y][target.x], 'and it stopped being known at all');
  assert.ok(count(g.charted) < before, 'nothing at all was settled by standing there');
});

test('the chart survives the stairs, and so does the difference', () => {
  const g = chartedGame('chart-memo');
  const before = count(g.charted);
  g.loadFloor(1);
  g.loadFloor(0);
  assert.equal(count(g.charted), before, 'the drawn map came back as walked ground, or not at all');
});

test('a save written before charts existed reads as ground you walked', () => {
  const g = chartedGame('chart-old');
  /* Leave first: stepping off the floor snapshots it, so stripping the row
   * before that would only have it written straight back. */
  g.loadFloor(1);
  const memo = g.floorMemo(g.state.player.dungeonId, 0);
  delete memo.charted;                    /* exactly what an older save holds */
  g.loadFloor(0);
  assert.equal(count(g.charted), 0, 'an old save invented hearsay it never had');
  assert.ok(count(g.seen) > 0, 'and lost the map it did have');
});
