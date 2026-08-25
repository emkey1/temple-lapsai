/* Procedural dungeon floor generation: rooms, corridors, doors, secret doors,
 * stairs, and dispersal of monsters, items, treasure and NPCs. Deterministic per
 * (dungeonId, floorIdx) so re-entering a floor yields the same layout.
 */

import { RNG, hashSeed } from './rng.js';
import { getTheme } from './base.js';

export const T = {
  WALL: 0,
  FLOOR: 1,
  DOOR_C: 2,
  DOOR_O: 3,
  SECRET: 4,
  UP: 5,
  DOWN: 6,
  WATER: 7,
  ALTAR: 8,
  DEN: 9,
};

export const W = 64;
export const H = 44;

/* A secret door is a wall until it is found, at which point it becomes an open
 * door. Listing it as travelable let anyone walk straight through one. */
export function isTravelable(tile) {
  return tile === T.FLOOR || tile === T.DOOR_O || tile === T.UP ||
         tile === T.DOWN || tile === T.ALTAR || tile === T.DEN || tile === T.WATER;
}

/* Water is crossable but slow — see Game.tryMove. */
export function isSlowGoing(tile) { return tile === T.WATER; }

export function isWall(tile) { return tile === T.WALL || tile === T.DOOR_C || tile === T.SECRET; }

export function isDoor(tile) { return tile === T.DOOR_C || tile === T.DOOR_O || tile === T.SECRET; }

function carveRoom(grid, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (grid[y][x] === T.WALL) grid[y][x] = T.FLOOR;
    }
  }
}

function overlaps(a, b) {
  return a.x - 1 <= b.x + b.w && a.x + a.w + 1 >= b.x && a.y - 1 <= b.y + b.h && a.y + a.h + 1 >= b.y;
}

function carveCorridor(grid, rng, ax, ay, bx, by) {
  let x = ax, y = ay;
  /* Seeded, not Math.random: the module's contract is that a floor is
   * reproducible from (dungeonId, floorIdx), and the tests depend on it.
   *
   * TWO WIDE — ten feet, the playtest's ruler. A one-tile corridor made
   * every fight a single-file queue: nobody could stand beside the
   * fighter, nothing could be flanked, and the thief was a spectator
   * with a salary. Every horizontal run carves its southern twin, every
   * vertical run its eastern one. */
  const dig = (dx, dy) => {
    if (dx < 1 || dy < 1 || dx >= W - 1 || dy >= H - 1) return;
    if (grid[dy][dx] === T.WALL) grid[dy][dx] = T.FLOOR;
  };
  const horizFirst = rng.chance(0.5);
  if (horizFirst) {
    while (x !== bx) { x += Math.sign(bx - x); dig(x, y); dig(x, y + 1); }
    while (y !== by) { y += Math.sign(by - y); dig(x, y); dig(x + 1, y); }
  } else {
    while (y !== by) { y += Math.sign(by - y); dig(x, y); dig(x + 1, y); }
    while (x !== bx) { x += Math.sign(bx - x); dig(x, y); dig(x + 1, y); }
  }
}

function installDoors(grid, rng) {
  const doors = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] !== T.WALL) continue;
      const N = grid[y - 1][x], S = grid[y + 1][x], E = grid[y][x + 1], W = grid[y][x - 1];
      const horiz = (N === T.FLOOR || N === T.DEN) && (S === T.FLOOR || S === T.DEN);
      const vert = (E === T.FLOOR || E === T.DEN) && (W === T.FLOOR || W === T.DEN);
      if (horiz !== vert) doors.push([x, y]);
    }
  }
  /* Ordinary doorways are never secret. These gaps sit on the corridor network,
   * which is connected by construction, so a secret door here has a way around
   * it and finding one only ever saves a walk. The only hidden doors on a floor
   * are the ones that gate something: the cache and the boss den. */
  for (const [x, y] of doors) {
    grid[y][x] = rng.chance(0.14) ? T.DOOR_O : T.DOOR_C;
  }
}

/* WATER SHAPED LIKE A DROWNED WARREN.
 *
 * It used to be sprinkled a tile at a time on a 3.5% roll — about eighteen
 * isolated puddles on a floor, every one of them walkable around, in a dungeon
 * whose whole conceit is that the tide comes in twice a day. Sparse, and
 * therefore pointless: wading costs the turn twice over and wakes whatever is
 * within six tiles, and none of that is a decision if you can step past it.
 *
 * The drains run with it and the low rooms stand in it, and there is more of
 * it the deeper you go. */
function populateWater(grid, rng, theme, rooms, floorIdx, den, cache) {
  if (theme !== 'sewers') return;
  const inRect = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  /* Only plain floor floods, which spares the stairs, the doors and the altar
   * by their tile types; the den and the cache are spared by name. */
  const dry = (x, y) => grid[y][x] !== T.FLOOR ||
    (den && x >= den.x - 1 && x < den.x + den.w + 1 && y >= den.y - 1 && y < den.y + den.h + 1) ||
    inRect(cache, x, y);
  const inAnyRoom = (x, y) => rooms.some((r) => inRect(r, x, y));

  /* THE DRAINS. A channel along a corridor is the decision the whole feature
   * exists for: wade it, slowly and loudly, or walk the long way round. */
  const corridors = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) if (!dry(x, y) && !inAnyRoom(x, y)) corridors.push([x, y]);
  }
  /* Deeper is wetter: the floors themselves grow with depth, so the number of
   * drains has to grow faster than they do or the warren dries out as you
   * descend. */
  const channels = 3 + floorIdx + rng.int(0, 2);
  for (let c = 0; c < channels && corridors.length; c++) {
    const queue = [corridors[rng.int(0, corridors.length - 1)]];
    const seen = new Set([queue[0][1] * W + queue[0][0]]);
    let run = 8 + floorIdx * 2 + rng.int(0, 12);
    while (queue.length && run > 0) {
      const [x, y] = queue.shift();
      if (dry(x, y) || inAnyRoom(x, y)) continue;
      grid[y][x] = T.WATER;
      run--;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const k = ny * W + nx;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }

  /* STANDING POOLS, with a dry rim so a flooded room is still a room and the
   * doorways into it stay walkable. */
  for (const r of rooms) {
    if (r.w < 5 || r.h < 4) continue;
    if (!rng.chance(0.35 + floorIdx * 0.12)) continue;
    const px = r.x + 1 + rng.int(0, Math.max(0, r.w - 4));
    const py = r.y + 1 + rng.int(0, Math.max(0, r.h - 3));
    const pw = Math.max(1, Math.min(r.x + r.w - 1 - px, 2 + rng.int(0, 3)));
    const ph = Math.max(1, Math.min(r.y + r.h - 1 - py, 1 + rng.int(0, 2)));
    for (let y = py; y < py + ph; y++) {
      for (let x = px; x < px + pw; x++) if (!dry(x, y)) grid[y][x] = T.WATER;
    }
  }
}

/* Somewhere wet to put something worth wading for. */
function findWetSpot(grid, rng, up, clearDist) {
  const wet = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] !== T.WATER) continue;
      if (Math.abs(x - up.x) + Math.abs(y - up.y) < clearDist) continue;
      wet.push({ x, y });
    }
  }
  return wet.length ? wet[rng.int(0, wet.length - 1)] : null;
}

function cx(r) { return r.x + Math.floor(r.w / 2); }
function cy(r) { return r.y + Math.floor(r.h / 2); }

/* Bumped whenever the generator changes shape or its rng draws move. Floor
 * memories record "monster 4 is dead" by index, so they are only meaningful
 * against the generator that produced them. */
export const GEN_VERSION = 6;   /* corridors carved two wide */

const CACHE = 3;   /* a hidden cache is CACHE x CACHE */

/* Where a cache would sit if it hung off this side of this room, with exactly
 * one wall tile between the two. */
function cacheRect(r, side) {
  if (side === 'w') return { x: r.x - 1 - CACHE, y: cy(r) - 1, w: CACHE, h: CACHE };
  if (side === 'e') return { x: r.x + r.w + 1, y: cy(r) - 1, w: CACHE, h: CACHE };
  if (side === 'n') return { x: cx(r) - 1, y: r.y - 1 - CACHE, w: CACHE, h: CACHE };
  return { x: cx(r) - 1, y: r.y + r.h + 1, w: CACHE, h: CACHE };
}

function cacheDoor(r, side) {
  if (side === 'w') return { x: r.x - 1, y: cy(r) };
  if (side === 'e') return { x: r.x + r.w, y: cy(r) };
  if (side === 'n') return { x: cx(r), y: r.y - 1 };
  return { x: cx(r), y: r.y + r.h };
}

function rectsTouch(a, b) {
  return !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.h <= b.y || a.y >= b.y + b.h);
}

/* True only if the rect, plus a one-tile margin, is untouched rock — so
 * carving it cannot break into a room, a corridor or the map edge. */
function isSolid(grid, rect) {
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      if (grid[y][x] !== T.WALL) return false;
    }
  }
  return true;
}

/* A cache with no way in but one hidden door.
 *
 * Every other secret door sits on the corridor network, and that network is
 * connected by construction — so finding one only ever saved you a walk. This
 * is the one that pays: solid rock on every side but the door. */
function installHiddenCache(grid, rooms, rng, den) {
  for (const r of rng.shuffle(rooms)) {
    for (const side of rng.shuffle(['n', 's', 'e', 'w'])) {
      const rect = cacheRect(r, side);
      /* Never inside the boss den. Carved there, the den is stamped over it
       * and the boss stands in the middle of the loot. */
      if (den && rectsTouch(rect, { x: den.x - 1, y: den.y - 1, w: den.w + 2, h: den.h + 2 })) continue;
      if (!isSolid(grid, rect)) continue;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) grid[y][x] = T.FLOOR;
      }
      const door = cacheDoor(r, side);
      grid[door.y][door.x] = T.SECRET;
      return { ...rect, door };
    }
  }
  return null;
}

const DEN_FRAME = { x: W - 16, y: H - 14, w: 13, h: 11 };

function installBossDen(grid, up) {
  const frame = DEN_FRAME;
  for (let y = frame.y - 1; y < frame.y + frame.h + 1; y++) {
    for (let x = frame.x - 1; x < frame.x + frame.w + 1; x++) {
      grid[y][x] = T.WALL;
    }
  }
  for (let y = frame.y; y < frame.y + frame.h; y++) {
    for (let x = frame.x; x < frame.x + frame.w; x++) {
      grid[y][x] = T.DEN;
    }
  }

  /* The door goes in the west WALL of the frame, not in the first interior
   * column — putting it at frame.x leaves the box sealed. */
  const doorY = frame.y + Math.floor(frame.h / 2);
  const doorX = frame.x - 1;
  grid[doorY][doorX] = T.SECRET;

  /* The den was stamped over whatever the corridor pass had carved here, so cut
   * a fresh approach — all the way back to the up-stairs, which is the one tile
   * guaranteed to be where the player starts. Vertical leg first, along the
   * column just west of the frame; the horizontal leg then only runs east of
   * the frame on rows the den does not occupy. The path can never re-enter it. */
  const laneX = doorX - 1;
  /* Clears standing water as well as rock: this lane is the only way in, so it
   * must be walkable whatever the theme scattered across it. */
  const carve = (x, y) => { if (grid[y][x] === T.WALL || grid[y][x] === T.WATER) grid[y][x] = T.FLOOR; };
  carve(laneX, doorY);
  for (let y = doorY; y !== up.y; ) { y += Math.sign(up.y - y); carve(laneX, y); }
  for (let x = laneX; x !== up.x; ) { x += Math.sign(up.x - x); carve(x, up.y); }
  return frame;
}

/* The monster pool is sorted shallowest-first and opens up as you descend.
 * Drawing from it UNIFORMLY is what built the wall on Temple floor 3: the pool
 * gains tier-6 mummies with nothing at tier 5, and a level-2 character met
 * three of them at the same odds as a rat. Weighting toward the shallow end
 * keeps the deep things as an occasional shock rather than the average case. */
/* Weighted towards the gentle end of the POOL — which is now the gentle end of
 * a narrow band around this floor's depth, not the gentle end of the whole
 * bestiary. That distinction is the whole fix: the weighting was always right,
 * and it was drawing from a pool that still had Sewer Rats in it on the last
 * floor of the second dungeon. Reversing it instead makes every floor in the
 * game harder and breaks the ramp — measured, and put back. */
function pickWeighted(rng, pool) {
  if (!pool.length) return undefined;
  const n = pool.length;
  const weight = (i) => n - i;
  let total = 0;
  for (let i = 0; i < n; i++) total += weight(i);
  let roll = rng.next() * total;
  for (let i = 0; i < n; i++) {
    roll -= weight(i);
    if (roll < 0) return pool[i];
  }
  return pool[n - 1];
}

/* Everything walkable from a starting tile, treating closed and secret doors
 * as passable — the player can open one and find the other. */
function floodFrom(grid, start) {
  const seen = new Set([start.y * W + start.x]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = y * W + x;
      if (seen.has(k)) continue;
      const t = grid[y][x];
      if (t === T.WALL) continue;
      seen.add(k);
      queue.push({ x, y });
    }
  }
  return seen;
}

/* Carve an L from a to b without breaking into the den, trying both
 * orientations and taking whichever stays clear of it. */
function carveClearOfDen(grid, rng, ax, ay, bx, by, den) {
  const touchesDen = (x, y) => den && x >= den.x - 1 && x <= den.x + den.w && y >= den.y - 1 && y <= den.y + den.h;
  const paths = [
    () => { const out = []; let x = ax, y = ay;
      while (x !== bx) { x += Math.sign(bx - x); out.push([x, y]); }
      while (y !== by) { y += Math.sign(by - y); out.push([x, y]); }
      return out; },
    () => { const out = []; let x = ax, y = ay;
      while (y !== by) { y += Math.sign(by - y); out.push([x, y]); }
      while (x !== bx) { x += Math.sign(bx - x); out.push([x, y]); }
      return out; },
  ];
  const clear = paths.map((f) => f()).find((path) => !path.some(([x, y]) => touchesDen(x, y)));
  const chosen = clear || paths[rng.chance(0.5) ? 0 : 1]();
  for (const [x, y] of chosen) if (grid[y][x] === T.WALL) grid[y][x] = T.FLOOR;
}

function repairConnectivity(grid, rooms, up, rng, den) {
  for (let pass = 0; pass < rooms.length + 2; pass++) {
    const reach = floodFrom(grid, up);
    const orphan = rooms.find((r) => {
      const x = cx(r), y = cy(r);
      return grid[y][x] !== T.WALL && !reach.has(y * W + x);
    });
    if (!orphan) return;
    carveClearOfDen(grid, rng, cx(orphan), cy(orphan), up.x, up.y, den);
  }
}

function insideDen(den, x, y) {
  if (!den) return false;
  return x >= den.x - 1 && x <= den.x + den.w && y >= den.y - 1 && y <= den.y + den.h;
}

function findSpot(grid, rooms, up, rng, clearDist, den) {
  for (let tries = 0; tries < 40; tries++) {
    const r = rng.pick(rooms);
    const x = r.x + rng.int(0, r.w - 1);
    const y = r.y + rng.int(0, r.h - 1);
    if (grid[y][x] !== T.FLOOR) continue;
    if (insideDen(den, x, y)) continue;
    if (Math.abs(x - up.x) + Math.abs(y - up.y) < clearDist) continue;
    return { x, y };
  }
  return null;
}

export function generateFloor(opts) {
  const { dungeon, floorIdx, state } = opts;
  const seed = opts.seed || hashSeed(`${dungeon.id}:${floorIdx}`);
  const rng = new RNG(seed);
  const theme = getTheme(dungeon.theme);

  const grid = Array.from({ length: H }, () => Array(W).fill(T.WALL));

  const isLast = floorIdx >= dungeon.floors - 1;
  const denFrame = isLast ? DEN_FRAME : null;

  const rooms = [];
  const maxRooms = 9 + rng.int(0, 4);
  for (let i = 0; i < maxRooms * 5; i++) {
    if (rooms.length >= maxRooms) break;
    const w = rng.int(3, dungeon.theme === 'halls' ? 11 : 8);
    const h = rng.int(3, dungeon.theme === 'halls' ? 8 : 6);
    const x = rng.int(1, W - w - 2);
    const y = rng.int(1, H - h - 2);
    const r = { x, y, w, h };
    if (rooms.some((o) => overlaps(r, o))) continue;
    /* Not under the boss den. A room there is stamped over, and the corridors
     * that reached it are cut, which orphans whatever they also served. */
    if (denFrame && rectsTouch(r, { x: denFrame.x - 2, y: denFrame.y - 2, w: denFrame.w + 4, h: denFrame.h + 4 })) continue;
    rooms.push(r);
  }
  rooms.forEach((r) => carveRoom(grid, r));

  if (rooms.length < 2) {
    rooms.length = 0;
    rooms.push({ x: 4, y: 4, w: 10, h: 8 }, { x: W - 18, y: H - 16, w: 10, h: 8 });
    rooms.forEach((r) => carveRoom(grid, r));
  }

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(grid, rng, cx(rooms[i - 1]), cy(rooms[i - 1]), cx(rooms[i]), cy(rooms[i]));
  }
  installDoors(grid, rng);

  /* Choose the stairs before stamping the den: the player must never start
   * inside it, and the den's approach corridor is cut back to this tile. */
  const upRoom = rooms.find((r) => !insideDen(denFrame, cx(r), cy(r))) || rooms[0];
  const up = { x: cx(upRoom), y: cy(upRoom) };
  const den = isLast ? installBossDen(grid, up) : null;
  grid[up.y][up.x] = T.UP;
  let down = null;
  if (!isLast) {
    const downRoom = rooms[rooms.length - 1];
    down = { x: cx(downRoom), y: cy(downRoom) };
    grid[down.y][down.x] = T.DOWN;
  }

  /* The den is stamped over whatever was here, which can cut a corridor and
   * strand the rooms it served. Reconnect anything the flood cannot reach. */
  repairConnectivity(grid, rooms, up, rng, den);

  const cache = installHiddenCache(grid, rooms, rng, den);
  populateWater(grid, rng, dungeon.theme, rooms, floorIdx, den, cache);

  const threat = dungeon.threat || 0;
  const monsterPool = opts.monsterPool && opts.monsterPool.length ? opts.monsterPool : null;

  const monsters = [];
  const monsterCount = 7 + floorIdx * 4 + rng.int(0, 3);
  for (let i = 0; i < monsterCount; i++) {
    const t = monsterPool ? pickWeighted(rng, monsterPool) : opts.pickMonster && opts.pickMonster(floorIdx, rng);
    if (!t) continue;
    /* A thing that lives in water lives IN the water. The Upper Reaches had
     * Giant Leeches standing about on dry stone in a drowned warren. */
    const swims = t.props && t.props.indexOf('aquatic') >= 0;
    const wet = swims ? findWetSpot(grid, rng, up, 6) : null;
    const pos = wet || findSpot(grid, rooms, up, rng, 6, den);
    if (!pos) continue;
    const m = scaledMonster(t, pos, threat, floorIdx, false);
    /* Lying in wait under the surface, until something wades past. */
    if (wet) m.submerged = true;
    monsters.push(m);
  }

  const boss = opts.boss;
  if (boss && den) {
    const pay = {
      x: den.x + Math.floor(den.w / 2) + 2,
      y: den.y + Math.floor(den.h / 2),
    };
    if (grid[pay.y][pay.x] === T.DEN) {
      monsters.push(scaledMonster(boss, pay, threat, floorIdx, true));
    }
  }

  const items = [];
  const itemCount = 4 + rng.int(0, 3);
  for (let i = 0; i < itemCount; i++) {
    const it = opts.pickItem ? opts.pickItem(floorIdx, rng) : null;
    if (!it) continue;
    /* Some of what is on the floor is IN the water, which is the other half of
     * making water matter: wading is slow and loud, so a thing lying in the
     * drain is a wager rather than a detour. The same items, not extra ones —
     * this is a decision, not a bonus. Nothing is placed anywhere the player
     * cannot see it from dry land, since it has to be a choice you can make. */
    const wet = rng.chance(0.3) ? findWetSpot(grid, rng, up, 3) : null;
    const pos = wet || findSpot(grid, rooms, up, rng, 3, den);
    if (!pos) continue;
    items.push({ i: it, x: pos.x, y: pos.y, auto: it.kind === 'special' });
  }

  if (boss && den) {
    const tpos = { x: den.x + Math.floor(den.w / 2) - 2, y: den.y + Math.floor(den.h / 2) };
    if (grid[tpos.y][tpos.x] === T.DEN) {
      items.push({ i: opts.makeTreasure ? opts.makeTreasure(floorIdx, rng) : null, x: tpos.x, y: tpos.y, auto: true });
    }
  }

  /* What the cache is for. Two draws from two floors deeper than you are, plus
   * something that was worth hiding. */
  if (cache && opts.pickItem) {
    const spots = [];
    for (let y = cache.y; y < cache.y + cache.h; y++) {
      for (let x = cache.x; x < cache.x + cache.w; x++) spots.push({ x, y });
    }
    for (const pos of rng.shuffle(spots).slice(0, 2)) {
      const it = opts.pickItem(floorIdx + 2, rng);
      if (it) items.push({ i: it, x: pos.x, y: pos.y, auto: it.kind === 'special' });
    }
    const centre = { x: cache.x + 1, y: cache.y + 1 };
    const hoard = opts.makeTreasure ? opts.makeTreasure(floorIdx + 2, rng) : null;
    if (hoard) items.push({ i: hoard, x: centre.x, y: centre.y, auto: true });
  }

  /* At least one thing to drink, every floor. */
  if (opts.pickConsumable) {
    const pos = findSpot(grid, rooms, up, rng, 4, den);
    if (pos) {
      const it = opts.pickConsumable(floorIdx, rng);
      if (it) items.push({ i: it, x: pos.x, y: pos.y, auto: false });
    }
  }

  const npcs = [];
  for (const tpl of (opts.npcs || [])) {
    const pos = findSpot(grid, rooms, up, rng, 2, den);
    if (pos) npcs.push({ tpl, x: pos.x, y: pos.y });
  }

  /* One altar per floor, in a room away from the stairs. The tile type existed
   * with a renderer and a travel rule and was never once placed.
   *
   * Drawn LAST on purpose: every rng draw shifts the stream, and taking one
   * earlier would move every monster and item after it — which silently
   * invalidates the floor memories in existing saves, since those record
   * "monster 4 is dead" by index. */
  const altar = findSpot(grid, rooms, up, rng, 8, den);
  if (altar) grid[altar.y][altar.x] = T.ALTAR;

  /* Stable ids, assigned in generation order. Because a floor regenerates
   * identically from its seed, the save can record "monster 4 is dead" and
   * "item 2 was taken" and have that still mean the same thing next visit. */
  monsters.forEach((m, i) => { m.idx = i; });
  items.forEach((it, i) => { it.idx = i; });

  return { w: W, h: H, tiles: grid, rooms, monsters, items, npcs, up, down, altar, cache, theme, seed, isLast, den, boss };
}

function scaledMonster(t, pos, threat, floorIdx, boss) {
  /* Depth decides how tough a monster is, not the player's level — scaling on
   * dLevel meant every level-up inflated every monster you had yet to meet. */
  const mul = 1 + floorIdx * 0.22 + Math.max(0, threat) * 0.06;
  /* A boss used to be given FOUR TIMES the hit points on its card, on top of
   * depth scaling and on top of a card that was already the biggest in the
   * bestiary. The Demon of Lapsai arrived with 1129 hit points — twenty-two
   * times anything else standing on that floor — against a level 7 character
   * dealing about two damage a turn. Measured over 720 duels across every
   * class, at every level up to 15, in the best kit in the game: no one ever
   * won, once. The bosses are big because their cards are big. */
  const hp = Math.max(1, Math.round((t.hpMax || 8) * mul));
  const dmgBonus = ((t.damage && t.damage.bonus) || 0) + Math.floor(floorIdx / 2);
  return {
    t,
    x: pos.x, y: pos.y,
    hp, maxhp: hp,
    boss,
    aggro: false,
    toHit: (t.toHit || 0) + Math.floor(floorIdx / 2),
    dmg: {
      dice: (t.damage && t.damage.dice) || 1,
      sides: (t.damage && t.damage.sides) || 4,
      bonus: dmgBonus,
    },
    xp: Math.round((t.xp || 10) * (1 + floorIdx * 0.15)),
    goldMin: t.goldMin || 0,
    goldMax: (t.goldMax || 0) + floorIdx * 2,
  };
}

/* THE WHETSTONE, laid out by hand. The town is not generated — it is a
 * place, and places do not reroll. A hamlet under daylight: seven stone
 * buildings around a green with a pond and a market cross, keepers at
 * their counters, residents at their doors with something to say, dirt
 * paths worn between them, and a row of dungeon mouths in the east
 * field — one per way down the world currently offers. The caller hands
 * in that list; everything else is fixed.
 *
 * Returns a floor in the same shape generateFloor returns, plus `mouths`
 * ([{x, y, dungeonId, name}]), `entry`, and `props` — standing furniture
 * plus `flat` ground pieces (the paths) the renderer lays under feet. */
export function generateTownFloor(dungeons) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  /* The clearing, with an uneven treeline: a hash decides where the woods
   * lean in a tile or two, so the edge reads grown rather than drawn. */
  for (let y = 6; y <= 40; y++) {
    for (let x = 6; x <= 58; x++) {
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const edge = (x <= 7 || x >= 57 || y <= 7 || y >= 39) && (h % 3 === 0);
      if (!edge) tiles[y][x] = T.FLOOR;
    }
  }

  /* A building is a ring of wall with a doorway. `doorSide` is 's' or 'n';
   * the keeper's spot is just outside the door. */
  /* THE BUILDING KIT, derived on a test rig from Clint Bellanger's
   * medieval tiles: a building is TWO columns wide and as deep as it
   * likes. The west column wears the even-numbered pieces, the east
   * column their odd mirrors, and the two rooflines meet at the ridge --
   * one whole timber-framed house. The door sits in the east column's
   * southmost row, facing the lane; the keeper stands on the grass
   * beside it. Interiors do not exist: a cottage is a cottage, not a
   * ring around a room nobody enters. */
  const houseWalls = new Set();
  const houseDoors = new Set();
  const house = (hx, hy, depth) => {
    for (let y = hy; y < hy + depth; y++) {
      for (let x = hx; x < hx + 2; x++) {
        tiles[y][x] = T.WALL;
        houseWalls.add(y * W + x);
      }
    }
    const dy = hy + depth - 1;
    houseDoors.add(dy * W + (hx + 1));
    return { x: hx + 2, y: dy };
  };

  const npcs = [];
  const post = (spot, tpl) => npcs.push({ tpl, x: spot.x, y: spot.y });

  /* The keepers: counters with faces. */
  post(house(12, 10, 4), { id: 'provisioner', name: 'The Provisioner', sex: 'female', color: 'gold', service: 'shop',
    desc: 'Buys what you haul up, sells what the dark is stingy with.' });
  post(house(27, 10, 4), { id: 'lector', name: 'The Lector', sex: 'male', color: 'cyan', service: 'sage',
    desc: 'Reads runes for coin, and prises curses loose for more.' });
  post(house(40, 8, 6), { id: 'innkeep', name: 'The Drowned Lantern', sex: 'male', color: 'amber', service: 'inn',
    desc: 'A tavern with three rooms and one price. The lantern over the door was pulled from the flooded floor.' });
  post(house(12, 27, 5), { id: 'muster', name: 'The Muster', sex: 'female', color: 'brightgreen', service: 'muster',
    desc: 'Sword-arms fresh off the road, seasoned for a price.' });

  /* The residents: doors worth knocking on, words that answer offline —
   * topics keyword-match, fallbacks catch the rest. */
  post(house(25, 30, 3), {
    id: 'maren', name: 'Maren', sex: 'female', title: 'the ferrier\u2019s widow', color: 'white',
    intro: 'You have the look of the stairs about you. My Aldous had it too, before the temple kept him.',
    topics: [
      { keys: ['temple', 'stairs'], replies: ['The temple took my husband and gave back his boots. Mind the water on the lower floors \u2014 he never did.'] },
      { keys: ['husband', 'aldous'], replies: ['Aldous. He shod horses and then he shod himself for the dark, and only one trade paid.'] },
      { keys: ['lector'], replies: ['The Lector reads true, but count your change. Grief has not made me generous.'] },
      { keys: ['water', 'drain'], replies: ['The drains under the temple are not empty. That is all I will say with the light going.'] },
    ],
    fallbacks: [
      'The green is quiet. Keep it so.',
      'Buy your draughts before you go down, not after you need them.',
    ],
  });
  post(house(34, 29, 3), {
    id: 'casp', name: 'Old Casp', sex: 'male', title: 'a digger of long standing', color: 'amber',
    intro: 'I dug half the cellars in this town and one grave I regret. Ask, or move along.',
    topics: [
      { keys: ['grave'], replies: ['Not mine to open again. But the gravedigger\u2019s girl grew up strong \u2014 turned earth is good soil.'] },
      { keys: ['dig', 'cellar', 'stone'], replies: ['Every cellar in the Whetstone hits stone at six feet. The same stone the temple is cut from. Think on that.'] },
      { keys: ['bone'], replies: ['You will see bones down there laid neat as cutlery. Nothing lays bones neat but hands.'] },
      { keys: ['gold'], replies: ['Gold from below spends the same as gold from above. It just remembers where it has been.'] },
    ],
    fallbacks: [
      'These hands have opinions, and they are all about shovels.',
      'The mouths in the east field were dug from BELOW. Chew on that one.',
    ],
  });
  post(house(46, 25, 3), {
    id: 'tilda', name: 'Tilda', sex: 'female', title: 'keeper of the smallest cottage', color: 'brightgreen',
    intro: 'The lamps burn all night here since the company came. I find I sleep better for it.',
    topics: [
      { keys: ['lantern', 'inn', 'tavern'], replies: ['The Drowned Lantern? Good beds, honest ale, and the innkeep waters nothing but the horses.'] },
      { keys: ['muster'], replies: ['The Muster\u2019s people are braver than their prices suggest. Tip them.'] },
      { keys: ['whetstone', 'town', 'name'], replies: ['They named the town for the temple steps \u2014 the stone that keeps the knives of the world sharp.'] },
      { keys: ['company', 'east'], replies: ['Yours is the fourth company I have seen walk east. Walk back west. The others did not.'] },
    ],
    fallbacks: [
      'Mind the pond. The geese are worse than the kobolds.',
      'If you find a blue door down there, Old Casp owes me a story about it.',
    ],
  });

  /* The pond, and the green\u2019s old market cross. */
  for (let y = 19; y <= 22; y++) {
    for (let x = 16; x <= 20; x++) {
      if (Math.abs(y - 20.5) + Math.abs(x - 18) * 0.7 <= 2.4) tiles[y][x] = T.WATER;
    }
  }

  /* The mouths: one stair down per way the world offers, in a row along
   * the east field. */
  const mouths = [];
  (dungeons || []).forEach((d, i) => {
    const x = 52, y = 12 + i * 5;
    if (y > 36) return;
    tiles[y][x] = T.DOWN;
    mouths.push({ x, y, dungeonId: d.id, name: d.name });
  });

  /* Furniture (standing) and paths (flat, laid under feet). */
  const props = [
    { x: 9, y: 15, piece: 'barrelsStacked_S' },
    { x: 17, y: 15, piece: 'barrel_S' },
    { x: 36, y: 15, piece: 'tableRoundChairs_S' },
    { x: 44, y: 16, piece: 'tableShort_S' },
    { x: 47, y: 15, piece: 'barrels_S' },
    { x: 9, y: 26, piece: 'woodenCrates_S' },
    { x: 19, y: 26, piece: 'woodenCrate_S' },
    { x: 30, y: 20, piece: 'stoneColumn_S' },
    { x: 24, y: 35, piece: 'woodenPile_S' },
    { x: 40, y: 34, piece: 'chestClosed_S' },
    { x: 51, y: 28, piece: 'stoneColumnWood_S' },
  ];
  if (mouths.length) {
    props.push({ x: mouths[0].x - 1, y: mouths[0].y - 1, piece: 'stoneColumn_S' });
    props.push({ x: mouths[0].x + 1, y: mouths[0].y + 1, piece: 'stoneColumn_S' });
  }
  /* Village dressing from the grassland atlas itself (`atlas` pieces are
   * drawn from the town's own tileset): a fence line by the pond, the
   * smithy's anvil at the Provisioner's gable, a campfire in the muster
   * yard, and a little churchyard of leaning stones behind the Lector's.
   * All of it was looked at first. */
  const fenceX = 104, fenceY = 107, fenceEnd = 108, campfire = 102, anvil = 103,
    gravestone = 140, stump = 136, basket = 99, fern = 112;
  for (let x = 14; x <= 20; x += 2) props.push({ x, y: 24, atlas: fenceX });
  props.push({ x: 22, y: 24, atlas: fenceEnd });
  props.push({ x: 8, y: 16, atlas: anvil });
  props.push({ x: 16, y: 33, atlas: campfire });
  props.push({ x: 33, y: 8, atlas: gravestone });
  props.push({ x: 35, y: 7, atlas: gravestone });
  props.push({ x: 36, y: 9, atlas: gravestone });
  props.push({ x: 22, y: 8, atlas: stump });
  props.push({ x: 50, y: 34, atlas: stump });
  props.push({ x: 12, y: 21, atlas: basket });
  props.push({ x: 42, y: 22, atlas: fern });
  props.push({ x: 28, y: 36, atlas: fern });

  /* The worn path: from the shop fronts east through the green to the
   * mouths, flat dirt pieces the renderer lays on the grass. */
  const PATH = [];
  for (let x = 12; x <= 50; x++) {
    const y = x < 30 ? 18 + Math.round((x - 12) * 0.1) : 20 - Math.round((x - 30) * 0.15);
    PATH.push([x, y + 2]);
  }
  PATH.forEach(([x, y], i) => {
    if (tiles[y] && tiles[y][x] === T.FLOOR) {
      props.push({ x, y, piece: i % 4 === 0 ? 'dirtTiles_S' : 'dirt_S', flat: true });
    }
  });

  return {
    w: W, h: H, tiles, rooms: [], monsters: [], items: [], npcs,
    up: null, down: mouths.length ? { x: mouths[0].x, y: mouths[0].y } : null,
    isLast: false, den: null, mouths, props, houseWalls, houseDoors,
    entry: { x: 36, y: 22 },
  };
}
