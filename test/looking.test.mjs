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
