/* THE REGION MAP: the town, the ways down, the landmark names, and fast
 * travel by clicking one. Held still without a browser. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { isTravelable } from '../public/js/mapgen.js';

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

test('the road runs to a second town, walked the whole way', () => {
  const g = newGame('road');
  g.state.player.dungeonId = 'the-whetstone';
  g.state.player.bossesSlain = { serpent: true };
  assert.ok(g.regionPlaces().some((p) => p.id === 'far-reach'), 'the Far Reach is not on the map');
  assert.ok(g.travelTo('far-reach'), 'could not set out on the road');
  assert.match(g.state.player.dungeonId, /^road:/, 'the road was not walked — it teleported');
  assert.ok(g.currentFloor.road, 'the road floor is not a road');
  /* Walk it to the far gate. */
  const exit = g.currentFloor.roadExit;
  assert.ok(exit, 'the road has no far end');
  g.stepOn(exit.x, exit.y);
  assert.equal(g.state.player.dungeonId, 'far-reach', 'the road did not lead to the Far Reach');
  assert.equal(g.inTown(), true, 'the Far Reach is not treated as a town');
  assert.ok(g.currentFloor.npcs.some((n) => n.tpl.id === 'reach-chandler'), 'the Far Reach has no chandler');
  /* The coast town's way down is the drowned quarter, not the hill's stairs. */
  assert.ok((g.currentFloor.mouths || []).some((m) => m.dungeonId === 'drowned'), 'the Far Reach has no way down to the drowned quarter');
  assert.ok(!(g.currentFloor.mouths || []).some((m) => m.dungeonId === 'temple'), 'the hill stairs reached the coast');
  /* And the road runs back. */
  assert.ok(g.travelTo('the-whetstone'), 'could not set out on the road back');
  const back = g.currentFloor.roadExit;
  g.stepOn(back.x, back.y);
  assert.equal(g.state.player.dungeonId, 'the-whetstone', 'the road back did not lead home');
});

test('taking a road from within a town makes an event of it', () => {
  const g = newGame('road-event');
  g.state.player.dungeonId = 'the-whetstone';
  const before = g.logs.length;
  g.travelTo('far-reach');
  /* At least the road event's own line lands in the log. */
  assert.ok(g.logs.length > before, 'the road passed in silence');
});

test('the drowned quarter opens once the serpent is quiet', () => {
  const g = newGame('drowned');
  g.state.player.dungeonId = 'the-whetstone';
  assert.equal(g.travelTo('drowned'), false, 'the drowned quarter opened too early');
  g.state.player.bossesSlain = { serpent: true };
  assert.ok(g.regionPlaces().some((p) => p.id === 'drowned'), 'the drowned quarter never reached the map');
  assert.ok(g.travelTo('drowned'), 'could not take the road to the drowned quarter');
  assert.equal(g.state.player.dungeonId, 'drowned', 'the road did not lead to the drowned quarter');
});

test('a town has no road to itself', () => {
  const g = newGame('self-road');
  g.state.player.dungeonId = 'the-whetstone';
  assert.equal(g.travelTo('the-whetstone'), false, 'took the road to the town it already stood in');
});

test('the drowned quarter keeps its own bestiary, and its own keeper', async () => {
  const { getDungeon, getMonster } = await import('../public/js/base.js');
  const d = getDungeon('drowned');
  assert.ok(d.monsterWeights.includes('drowned-thing'), 'the drowned quarter has no drowned things');
  assert.ok(d.monsterWeights.includes('brine-hound'), 'no brine hounds in the drowned quarter');
  assert.equal(d.bossId, 'tidewright', 'the drowned quarter is kept by somebody else');
  assert.ok(getMonster('tidewright'), 'the tidewright does not exist');
  assert.ok(getMonster('drowned-thing').props.includes('aquatic'), 'a drowned thing that does not swim');
});

test('a camp on the road beds the company down, once', () => {
  const g = newGame('road-camp');
  g.state.player.dungeonId = 'the-whetstone';
  g.travelTo('far-reach');
  const camp = g.currentFloor.camp;
  assert.ok(camp, 'the road has no camp to make');
  g.state.player.hp = 1;
  g.state.player.wounds = 5;
  g.state.player.power = 0;
  g.stepOn(camp.x, camp.y);
  assert.equal(g.state.player.hp, g.state.player.maxhp, 'the camp did not set the company right');
  assert.equal(g.state.player.wounds, 0, 'the camp did not close wounds');
  /* Once a road: a second night in the same fire ring does nothing. */
  g.state.player.hp = 1;
  g.stepOn(camp.x, camp.y);
  assert.equal(g.state.player.hp, 1, 'the camp fired a second time');
});

test('a pedlar works the road', () => {
  const g = newGame('road-pedlar');
  g.state.player.dungeonId = 'the-whetstone';
  g.travelTo('far-reach');
  assert.ok((g.currentFloor.npcs || []).some((n) => n.tpl.id === 'road-pedlar'), 'nobody works the road');
});

test('the road keeps a shrine that shows the way, and a toll-man who charges for it', () => {
  const g = newGame('road-shrine');
  g.state.player.dungeonId = 'the-whetstone';
  g.travelTo('far-reach');
  const f = g.currentFloor;
  assert.ok(f.shrine, 'the road has no shrine to leave a coin at');
  assert.ok(isTravelable(f.tiles[f.shrine.y][f.shrine.x]), 'the shrine is off the walkable road');
  const toll = (f.npcs || []).find((n) => n.tpl.id === 'road-tollman');
  assert.ok(toll, 'nobody crews the high crossing');
  assert.ok(isTravelable(f.tiles[toll.y][toll.x]), 'the toll-man stands off the road');
  /* The shrine charts the floor, once. */
  g.seen = g.seen.map((row) => row.map(() => false));
  g.stepOn(f.shrine.x, f.shrine.y);
  assert.ok(g.seen.some((row) => row.some((v) => v)), 'the shrine did not show the way');
});

test('the toll is real: it takes the coin and shows the road', () => {
  const g = newGame('road-toll');
  g.state.player.dungeonId = 'the-whetstone';
  g.travelTo('far-reach');
  const toll = (g.currentFloor.npcs || []).find((n) => n.tpl.id === 'road-tollman');
  assert.ok(toll, 'nobody crews the crossing');
  assert.equal(toll.tpl.service, 'toll', 'the toll-man is not a counter');
  g.earnGold(1000);
  const cost = g.tollCost();
  const purse = g.purse();
  assert.ok(cost > 0, 'the toll is free');
  g.seen = g.seen.map((row) => row.map(() => false));
  assert.ok(g.payToll(), 'the toll could not be paid');
  assert.equal(g.purse(), purse - cost, 'the toll did not take the coin');
  assert.ok(g.seen.some((row) => row.some((v) => v)), 'paying the toll did not show the road');
});
