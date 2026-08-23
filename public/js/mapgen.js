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
   * reproducible from (dungeonId, floorIdx), and the tests depend on it. */
  const horizFirst = rng.chance(0.5);
  if (horizFirst) {
    while (x !== bx) { x += Math.sign(bx - x); if (grid[y][x] === T.WALL) grid[y][x] = T.FLOOR; }
    while (y !== by) { y += Math.sign(by - y); if (grid[y][x] === T.WALL) grid[y][x] = T.FLOOR; }
  } else {
    while (y !== by) { y += Math.sign(by - y); if (grid[y][x] === T.WALL) grid[y][x] = T.FLOOR; }
    while (x !== bx) { x += Math.sign(bx - x); if (grid[y][x] === T.WALL) grid[y][x] = T.FLOOR; }
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

function populateWater(grid, rng, theme) {
  if (theme !== 'sewers') return;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] === T.DOOR_C || grid[y][x] === T.SECRET) continue;
      if (grid[y][x] === T.FLOOR && rng.chance(0.035)) grid[y][x] = T.WATER;
    }
  }
}

function cx(r) { return r.x + Math.floor(r.w / 2); }
function cy(r) { return r.y + Math.floor(r.h / 2); }

/* Bumped whenever the generator changes shape or its rng draws move. Floor
 * memories record "monster 4 is dead" by index, so they are only meaningful
 * against the generator that produced them. */
export const GEN_VERSION = 4;

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
  populateWater(grid, rng, dungeon.theme);

  const threat = dungeon.threat || 0;
  const monsterPool = opts.monsterPool && opts.monsterPool.length ? opts.monsterPool : null;

  const monsters = [];
  const monsterCount = 7 + floorIdx * 4 + rng.int(0, 3);
  for (let i = 0; i < monsterCount; i++) {
    const t = monsterPool ? pickWeighted(rng, monsterPool) : opts.pickMonster && opts.pickMonster(floorIdx, rng);
    if (!t) continue;
    const pos = findSpot(grid, rooms, up, rng, 6, den);
    if (!pos) continue;
    monsters.push(scaledMonster(t, pos, threat, floorIdx, false));
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
    const pos = findSpot(grid, rooms, up, rng, 3, den);
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
