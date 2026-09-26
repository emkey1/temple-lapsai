/* THE REGION MAP: the town, the ways down, the landmark names, and fast
 * travel by clicking one. Held still without a browser. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';

test('the region shows the town and the ways down, with you on it', () => {
  const g = newGame('region');
  g.state.player.dungeonId = 'the-whetstone';
  const places = g.regionPlaces();
  const ids = places.map((p) => p.id);
  assert.ok(ids.includes('the-whetstone'), 'the town is not on the map');
  assert.ok(ids.includes('temple'), 'the first sanctum is not on the map');
  assert.ok(places.every((p) => typeof p.x === 'number' && typeof p.y === 'number'), 'a place has no coordinates');
  assert.equal(places.filter((p) => p.here).length, 1, 'not exactly one place is marked you-are-here');
  assert.ok(ids.includes('deep') === false, 'the endless stair opened before its gate');
});

test('the landmark names from the stories are drawn, but are not roads', () => {
  const g = newGame('region-land');
  const names = g.regionLandmarks().map((l) => l.name);
  assert.ok(names.includes('The Far Reach'), 'the Far Reach is not on the map');
  assert.ok(names.includes('The Drowned Quarter'), 'the drowned quarter is not on the map');
  assert.ok(g.regionLandmarks().every((l) => typeof l.x === 'number'), 'a landmark has nowhere to sit');
});

test('the map is how you travel, and it refuses the road you are on', () => {
  const g = newGame('region-travel');
  g.state.player.dungeonId = 'the-whetstone';
  assert.equal(g.travelTo('the-whetstone'), false, 'took the road to where it already stood');
  assert.ok(g.travelTo('temple'), 'could not take the road to the temple');
  assert.equal(g.state.player.dungeonId, 'temple', 'the road did not lead there');
  assert.equal(g.state.player.floorIdx, 0, 'the road did not arrive at the top');
  assert.ok(g.travelTo('the-whetstone'), 'could not take the road back to town');
  assert.equal(g.inTown(), true, 'the climb back did not reach the town');
  /* A gated sanctum has no road yet. */
  assert.equal(g.travelTo('serpent'), false, 'a locked sanctum let the road through');
});

test('the endless stair appears on the map once its gate is open', () => {
  const g = newGame('region-deep');
  g.state.player.bossesSlain = { serpent: true };
  assert.ok(g.regionPlaces().some((p) => p.id === 'deep'), 'the Lower Ledger never reached the map');
});
