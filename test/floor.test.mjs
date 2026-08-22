/* Floor invariants. A generated floor the player cannot walk across is the one
 * class of bug that is invisible by inspection and obvious to a flood fill. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DUNGEONS } from '../public/js/base.js';
import { T, W, H } from '../public/js/mapgen.js';
import { floorOf, canReach, reachableFrom } from './helpers.mjs';

const SEEDS = 25;

test('the boss is reachable from the up-stairs on every final floor', () => {
  for (const d of DUNGEONS) {
    for (let s = 0; s < SEEDS; s++) {
      const { floor } = floorOf(d.id, d.floors - 1, `boss-${d.id}-${s}`);
      const boss = floor.monsters.find((m) => m.boss);
      assert.ok(boss, `${d.id} seed ${s}: no boss spawned on the final floor`);
      assert.ok(canReach(floor, floor.up, boss), `${d.id} seed ${s}: boss sealed in its den`);
    }
  }
});

test('the player never starts inside the boss den', () => {
  for (const d of DUNGEONS) {
    for (let s = 0; s < SEEDS; s++) {
      const { floor } = floorOf(d.id, d.floors - 1, `spawn-${d.id}-${s}`);
      const den = floor.den;
      assert.ok(den, `${d.id}: final floor has no den`);
      const inside = floor.up.x >= den.x && floor.up.x < den.x + den.w &&
                     floor.up.y >= den.y && floor.up.y < den.y + den.h;
      assert.ok(!inside, `${d.id} seed ${s}: up-stairs placed inside the den`);
    }
  }
});

test('the down-stairs is reachable from the up-stairs', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors - 1; f++) {
      for (let s = 0; s < SEEDS; s++) {
        const { floor } = floorOf(d.id, f, `down-${d.id}-${f}-${s}`);
        assert.ok(canReach(floor, floor.up, floor.down), `${d.id} floor ${f} seed ${s}: down-stairs cut off`);
      }
    }
  }
});

/* This is the invariant sewer water used to break: it left one floor of The
 * Upper Reaches with 30 of 418 tiles reachable. Water is now wadeable. */
test('the whole floor is reachable from the up-stairs', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < SEEDS; s++) {
        const { floor } = floorOf(d.id, f, `open-${d.id}-${f}-${s}`);
        assert.equal(floor.tiles[floor.up.y][floor.up.x], T.UP);
        const open = floor.tiles.flat().filter((t) => t !== T.WALL).length;
        const reached = reachableFrom(floor, floor.up).size;
        assert.equal(reached, open, `${d.id} floor ${f} seed ${s}: ${open - reached} tiles walled off from the entrance`);
      }
    }
  }
});

test('water is crossable, so sewer floors hold together', () => {
  const sewers = DUNGEONS.filter((x) => x.theme === 'sewers');
  assert.ok(sewers.length, 'no sewer-themed dungeon to check');
  for (const d of sewers) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < SEEDS; s++) {
        const { floor } = floorOf(d.id, f, `wet-${d.id}-${f}-${s}`);
        const water = floor.tiles.flat().filter((t) => t === T.WATER).length;
        const open = floor.tiles.flat().filter((t) => t !== T.WALL).length;
        assert.ok(water > 0, `${d.id} floor ${f} seed ${s}: no water generated at all`);
        assert.equal(reachableFrom(floor, floor.up).size, open, `${d.id} floor ${f} seed ${s}: water cut the floor apart`);
      }
    }
  }
});
