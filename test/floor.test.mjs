/* Floor invariants. A generated floor the player cannot walk across is the one
 * class of bug that is invisible by inspection and obvious to a flood fill. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DUNGEONS } from '../public/js/base.js';
import { T, W, H, isTravelable, doorLeafFacesSouth } from '../public/js/mapgen.js';
import { floorOf, canReach, reachableFrom, newGame } from './helpers.mjs';

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

/* THE LOWER LEDGER: the stair past the three founding sanctums. It has no last
 * floor, so a keyless company can keep going down for ever. */
test('the endless stair never ends, and keeps a boss every fifth landing', () => {
  const a = floorOf('deep', 0, 'ledger-0');
  assert.ok(a.floor.down, 'the first landing had no way down');
  assert.equal(a.floor.monsters.some((m) => m.boss), false, 'the first landing had a boss');
  const b = floorOf('deep', 4, 'ledger-4');
  assert.ok(b.floor.monsters.some((m) => m.boss), 'the fifth landing kept no boss');
  assert.ok(b.floor.down, 'a boss landing had no way deeper');
  /* It is not one of the founding three... */
  assert.equal(a.g.baseDungeonIds().includes('deep'), false, 'the endless stair was counted a founding sanctum');
  /* ...and it only opens once the serpent is quiet. */
  assert.equal(newGame('open').availableDungeons().some((d) => d.id === 'deep'), false, 'it opened before the serpent fell');
  const g = newGame('open-2');
  g.state.player.bossesSlain = { serpent: true };
  assert.ok(g.availableDungeons().some((d) => d.id === 'deep'), 'it never opened at all');
});

/* The leaf hangs across the PASSAGE, which is perpendicular to the wall it
 * stands in — and the wall is what is solid on both sides. Read off the
 * north/south neighbours alone, the middle leaf of a run of doors (whose north
 * and south are the other leaves) faced the wall it stood in. */
test('a door leaf hangs across the passage, even in the middle of a run', () => {
  const grid = (rows) => rows.map((r) => r.map((c) => ({ W: T.WALL, '.': T.FLOOR, C: T.DOOR_C }[c])));
  /* East-west wall, north-south passage: the leaf is on the south face. */
  assert.equal(doorLeafFacesSouth(grid([
    ['.', '.', '.'],
    ['W', 'C', 'W'],
    ['.', '.', '.'],
  ]), 1, 1), true);
  /* North-south wall, east-west passage: the leaf is on the east face. */
  assert.equal(doorLeafFacesSouth(grid([
    ['.', 'W', '.'],
    ['.', 'C', '.'],
    ['.', 'W', '.'],
  ]), 1, 1), false);
  /* The MIDDLE of a run of three: north and south are leaves, not wall. */
  assert.equal(doorLeafFacesSouth(grid([
    ['.', 'W', '.'],
    ['.', 'C', '.'],
    ['.', 'C', '.'],
    ['.', 'C', '.'],
    ['.', 'W', '.'],
  ]), 1, 2), false, 'the middle leaf of a run faces the wall it stands in');
});

test('every leaf of a run of doors faces the same way', () => {
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      for (let s = 0; s < 20; s++) {
        const { floor } = floorOf(d.id, f, `leaf-${d.id}-${f}-${s}`);
        const g = floor.tiles;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const t = g[y][x];
            if (t !== T.DOOR_C && t !== T.DOOR_O) continue;
            const mine = doorLeafFacesSouth(g, x, y);
            for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
              const q = g[y + dy][x + dx];
              if (q !== t) continue;
              assert.equal(doorLeafFacesSouth(g, x + dx, y + dy), mine,
                `${d.id} ${f}/${s}: a run of doors at ${x},${y} faces two ways`);
            }
          }
        }
      }
    }
  }
});
