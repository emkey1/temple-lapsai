/* Floor invariants. A generated floor the player cannot walk across is the one
 * class of bug that is invisible by inspection and obvious to a flood fill. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DUNGEONS } from '../public/js/base.js';
import { T, W, H, isTravelable } from '../public/js/mapgen.js';
import { floorOf, canReach, reachableFrom } from './helpers.mjs';

const SEEDS = 80;

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

/* ---- hidden caches ----
 * Secret doors used to be decorative. installDoors picks doorway gaps on the
 * corridor network, and that network is connected by construction, so a secret
 * door there could only ever save you a walk. Measured before this: of 250
 * generated secret doors, the only 30 that gated anything were boss dens. */

test('every floor hides a cache behind a secret door', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < SEEDS; s++) {
        const { floor } = floorOf(d.id, f, `cache-${d.id}-${f}-${s}`);
        assert.ok(floor.cache, `${d.id} floor ${f} seed ${s}: nothing hidden anywhere`);
        assert.equal(floor.tiles[floor.cache.door.y][floor.cache.door.x], T.SECRET);
      }
    }
  }
});

test('a cache is sealed until its door is found', () => {
  /* Reachability treating secret doors as the walls they look like. */
  const sealedFrom = (floor) => {
    const seen = new Set([floor.up.y * W + floor.up.x]);
    const queue = [floor.up];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = c.x + dx, y = c.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = y * W + x;
        if (seen.has(k)) continue;
        const t = floor.tiles[y][x];
        if (!isTravelable(t) && t !== T.DOOR_C) continue;   /* SECRET excluded */
        seen.add(k);
        queue.push({ x, y });
      }
    }
    return seen;
  };

  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < SEEDS; s++) {
        const { floor } = floorOf(d.id, f, `sealed-${d.id}-${f}-${s}`);
        const withoutSecrets = sealedFrom(floor);
        const key = floor.cache.y * W + floor.cache.x;
        assert.ok(!withoutSecrets.has(key), `${d.id} floor ${f} seed ${s}: the cache is reachable without finding anything`);
        assert.ok(reachableFrom(floor, floor.up).has(key), `${d.id} floor ${f} seed ${s}: the cache is sealed even WITH its door`);
      }
    }
  }
});

test('a cache is worth the turns spent tapping walls', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      const { floor } = floorOf(d.id, f, `loot-${d.id}-${f}`);
      const c = floor.cache;
      const inside = floor.items.filter((it) =>
        it.x >= c.x && it.x < c.x + c.w && it.y >= c.y && it.y < c.y + c.h);
      assert.ok(inside.length >= 2, `${d.id} floor ${f}: a cache holding ${inside.length} things is not worth finding`);
    }
  }
});

test('nothing else wanders into the cache', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < 10; s++) {
        const { floor } = floorOf(d.id, f, `nomob-${d.id}-${f}-${s}`);
        const c = floor.cache;
        const inside = (m) => m.x >= c.x && m.x < c.x + c.w && m.y >= c.y && m.y < c.y + c.h;
        assert.ok(!floor.monsters.some(inside), `${d.id} floor ${f} seed ${s}: something is sealed in with the loot`);
        assert.ok(!(floor.up.x >= c.x && floor.up.x < c.x + c.w && floor.up.y >= c.y && floor.up.y < c.y + c.h),
          'the player starts inside the cache');
      }
    }
  }
});

test('every secret door hides something', () => {
  /* Ordinary doorways sit on the corridor network, which is connected by
   * construction — so a secret door there has a way around it and finding one
   * only ever saves a walk. Measured before this: of 250 generated secret
   * doors, 220 were pure scenery. The only hidden doors are now the ones that
   * gate something: the cache, and the boss den. */
  const openWithoutSecrets = (floor) => {
    const seen = new Set([floor.up.y * W + floor.up.x]);
    const queue = [floor.up];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = c.x + dx, y = c.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = y * W + x;
        if (seen.has(k)) continue;
        const t = floor.tiles[y][x];
        if (!isTravelable(t) && t !== T.DOOR_C) continue;
        seen.add(k);
        queue.push({ x, y });
      }
    }
    return seen;
  };

  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < SEEDS; s++) {
        const { floor } = floorOf(d.id, f, `pointless-${d.id}-${f}-${s}`);
        const open = openWithoutSecrets(floor);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (floor.tiles[y][x] !== T.SECRET) continue;
            const behind = [[1, 0], [-1, 0], [0, 1], [0, -1]]
              .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
              .filter((n) => isTravelable(floor.tiles[n.y][n.x]) || floor.tiles[n.y][n.x] === T.DOOR_C)
              .some((n) => !open.has(n.y * W + n.x));
            assert.ok(behind, `${d.id} floor ${f} seed ${s}: a secret door at ${x},${y} with a way around it`);
          }
        }
      }
    }
  }
});
