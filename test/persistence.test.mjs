/* Floor memory. Floors regenerate from their seed, so the save records only
 * what the player changed. Before this, every trip down the stairs restocked
 * the level — an unlimited XP and gold faucet. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T } from '../public/js/mapgen.js';
import { newGame } from './helpers.mjs';

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
