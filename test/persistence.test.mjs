/* Floor memory. Floors regenerate from their seed, so the save records only
 * what the player changed. Before this, every trip down the stairs restocked
 * the level — an unlimited XP and gold faucet. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, isTravelable } from '../public/js/mapgen.js';
import { newGame, savedPlayer } from './helpers.mjs';

test('a floor regenerates identically from its seed', () => {
  const a = newGame('same');
  const b = newGame('same');
  a.loadFloor(1);
  b.loadFloor(1);
  assert.equal(
    a.currentFloor.tiles.map((r) => r.join('')).join(''),
    b.currentFloor.tiles.map((r) => r.join('')).join(''),
  );
});

test('monsters killed on a floor stay dead when you come back', () => {
  const g = newGame('deadstay');
  g.loadFloor(0);
  const before = g.currentFloor.monsters.length;
  assert.ok(before >= 3, 'need monsters to kill');
  g.killMonster(g.currentFloor.monsters[0]);
  g.killMonster(g.currentFloor.monsters[0]);
  g.loadFloor(1);
  g.loadFloor(0);
  assert.equal(g.currentFloor.monsters.length, before - 2, 'the dead came back');
});

test('loot taken on a floor is gone when you come back', () => {
  const g = newGame('lootgone');
  g.loadFloor(0);
  const item = g.currentFloor.items[0];
  assert.ok(item, 'need an item to take');
  const before = g.currentFloor.items.length;
  g.state.player.x = item.x;
  g.state.player.y = item.y;
  g.tryPickup(item.x, item.y, true);
  g.loadFloor(1);
  g.loadFloor(0);
  assert.equal(g.currentFloor.items.length, before - 1, 'the loot respawned');
});

test('doors you opened stay open', () => {
  const g = newGame('doors');
  g.loadFloor(0);
  const floor = g.currentFloor;
  let spot = null;
  for (let y = 0; y < floor.tiles.length && !spot; y++) {
    for (let x = 0; x < floor.tiles[y].length; x++) {
      if (floor.tiles[y][x] === T.DOOR_C) { spot = { x, y }; break; }
    }
  }
  assert.ok(spot, 'need a closed door on the floor');
  g.rememberDoor(spot.x, spot.y);
  g.loadFloor(1);
  g.loadFloor(0);
  assert.equal(g.currentFloor.tiles[spot.y][spot.x], T.DOOR_O, 'the door shut itself again');
});

test('the map you explored stays explored', () => {
  const g = newGame('explored');
  g.loadFloor(0);
  g.computeVisibility();
  const drawn = g.seen.flat().filter(Boolean).length;
  assert.ok(drawn > 0, 'nothing was explored to begin with');
  g.loadFloor(1);
  g.loadFloor(0);
  assert.ok(g.seen.flat().filter(Boolean).length >= drawn, 'the map was forgotten');
});

test('dropped items are still there when you come back', () => {
  const g = newGame('dropped');
  g.loadFloor(0);
  const p = g.state.player;
  const trinket = { name: 'Bent Spoon', kind: 'misc', slot: 'misc', uid: 'spoon-1', effects: {}, value: 1 };
  p.inventory.push(trinket);
  g.drop(trinket);
  g.loadFloor(1);
  g.loadFloor(0);
  assert.ok(g.currentFloor.items.some((it) => it.i && it.i.uid === 'spoon-1'), 'the drop vanished');
});

test('floor memory survives a save and reload', () => {
  const g = newGame('memo-save');
  g.loadFloor(0);
  const before = g.currentFloor.monsters.length;
  g.killMonster(g.currentFloor.monsters[0]);
  const saved = JSON.parse(JSON.stringify(g.save()));

  const g2 = newGame('memo-save');
  g2.restore(saved);
  g2.loadFloor(0);
  assert.equal(g2.currentFloor.monsters.length, before - 1, 'the kill was not saved');
});

test('a save written before floor memory existed still loads', () => {
  const g = newGame('legacy');
  const old = JSON.parse(JSON.stringify(g.save()));
  delete old.floors;
  const g2 = newGame('legacy');
  g2.restore(old);
  g2.loadFloor(0);
  assert.ok(g2.currentFloor, 'a legacy save could not load its floor');
});

test('a save cannot come back with more power than it can hold', () => {
  /* Two numbers claimed to be the maximum: the one on the player, which the
   * bar reads, and the one derived() computes, which regeneration clamps to.
   * A save with a stale stored maximum filled past its own brim — 26 of 20. */
  const g = newGame('overfull', 'mage');
  const state = JSON.parse(JSON.stringify(g.save()));
  savedPlayer(state).maxpower = 4;   /* stale, as a hand-edited or old save is */
  savedPlayer(state).power = 4;
  const back = newGame('overfull-2', 'mage');
  back.restore(state);
  const p = back.state.player;
  assert.ok(p.power <= p.maxpower, `${p.power} of ${p.maxpower}`);
  assert.equal(p.maxpower, back.computeMaxPower(), 'the stored maximum still disagrees with the real one');
});

/* ---- arriving on a floor ---- */

test('climbing a flight puts you on the stairs you came down, not the next ones up', () => {
  /* loadFloor placed the player on floor.up unconditionally, so going up from
   * floor two landed you on floor one's UP-staircase — the one out to camp —
   * rather than on the down-staircase you had just climbed. */
  const g = newGame('stairs-up', 'fighter');
  const p = g.state.player;
  p.dungeonId = 'temple';
  g.loadFloor(0);
  const down = { ...g.currentFloor.down };
  g.loadFloor(1);
  assert.deepEqual({ x: p.x, y: p.y }, { x: g.currentFloor.up.x, y: g.currentFloor.up.y },
    'coming down should land on the up-staircase');

  /* Now climb back, the way handleKey does. */
  g.loadFloor(0, 'down');
  assert.deepEqual({ x: p.x, y: p.y }, down,
    `climbing landed on ${p.x},${p.y} instead of the down-staircase at ${down.x},${down.y}`);
});

test('the bottom floor has no down-staircase to land on, and says so by not falling over', () => {
  const g = newGame('stairs-bottom', 'fighter');
  const p = g.state.player;
  p.dungeonId = 'temple';
  const last = 3;
  assert.doesNotThrow(() => g.loadFloor(last, 'down'));
  assert.ok(g.currentFloor.tiles[p.y][p.x] !== undefined, 'the player was placed off the map');
});

test('rebuilding the floor under a standing player leaves them standing', () => {
  /* A reload used to put you back on the stairs — which lost your place, and,
   * because a floor rebuilds its monsters from the seed, was a way to walk out
   * of a fight you were losing. */
  const g = newGame('stairs-keep', 'fighter');
  const p = g.state.player;
  p.dungeonId = 'temple';
  g.loadFloor(1);
  p.x = g.currentFloor.up.x;
  p.y = g.currentFloor.up.y;
  /* Step somewhere else that is walkable. */
  const spot = g.currentFloor.rooms
    .flatMap((r) => [{ x: r.x + 1, y: r.y + 1 }])
    .find((c) => isTravelable(g.currentFloor.tiles[c.y][c.x]) && (c.x !== p.x || c.y !== p.y));
  assert.ok(spot, 'no second walkable tile on the floor');
  p.x = spot.x; p.y = spot.y;

  g.loadFloor(1, 'keep');
  assert.deepEqual({ x: p.x, y: p.y }, spot, 'the player was moved to the stairs');
});

test('a remembered spot that is no longer walkable falls back to the stairs', () => {
  const g = newGame('stairs-stale', 'fighter');
  const p = g.state.player;
  p.dungeonId = 'temple';
  g.loadFloor(1);
  /* A wall, which is what a stale position looks like after a re-cut. */
  let wall = null;
  for (let y = 0; y < g.currentFloor.tiles.length && !wall; y++) {
    for (let x = 0; x < g.currentFloor.tiles[y].length; x++) {
      if (g.currentFloor.tiles[y][x] === T.WALL) { wall = { x, y }; break; }
    }
  }
  p.x = wall.x; p.y = wall.y;
  g.loadFloor(1, 'keep');
  assert.deepEqual({ x: p.x, y: p.y }, { x: g.currentFloor.up.x, y: g.currentFloor.up.y },
    'the player was left standing inside a wall');
});
