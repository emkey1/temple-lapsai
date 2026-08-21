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

export function isTravelable(tile, playerOnly = false) {
  if (tile === T.FLOOR || tile === T.DOOR_O || tile === T.SECRET || tile === T.UP || tile === T.DOWN || tile === T.ALTAR || tile === T.DEN) return true;
  return false;
}

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

function carveCorridor(grid, ax, ay, bx, by) {
  let x = ax, y = ay;
  const horizFirst = Math.random() < 0.5;
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
  for (const [x, y] of doors) {
    grid[y][x] = rng.chance(0.09) ? T.SECRET : (rng.chance(0.14) ? T.DOOR_O : T.DOOR_C);
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

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function cx(r) { return r.x + Math.floor(r.w / 2); }
function cy(r) { return r.y + Math.floor(r.h / 2); }

function installBossDen(grid) {
  const frame = { x: W - 16, y: H - 14, w: 13, h: 11 };
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
  grid[frame.y + Math.floor(frame.h / 2)][frame.x] = T.SECRET;
  return frame;
}

function findSpot(grid, rooms, up, rng, clearDist) {
  for (let tries = 0; tries < 40; tries++) {
    const r = rng.pick(rooms);
    const x = r.x + rng.int(0, r.w - 1);
    const y = r.y + rng.int(0, r.h - 1);
    if (grid[y][x] !== T.FLOOR && grid[y][x] !== T.DEN) continue;
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
    rooms.push(r);
  }
  rooms.forEach((r) => carveRoom(grid, r));

  if (rooms.length < 2) {
    rooms.length = 0;
    rooms.push({ x: 4, y: 4, w: 10, h: 8 }, { x: W - 18, y: H - 16, w: 10, h: 8 });
    rooms.forEach((r) => carveRoom(grid, r));
  }

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(grid, cx(rooms[i - 1]), cy(rooms[i - 1]), cx(rooms[i]), cy(rooms[i]));
  }
  installDoors(grid, rng);
  populateWater(grid, rng, dungeon.theme);

  const isLast = floorIdx >= dungeon.floors - 1;
  let den = null;
  if (isLast) den = installBossDen(grid);

  const up = { x: cx(rooms[0]), y: cy(rooms[0]) };
  grid[up.y][up.x] = T.UP;
  let down = null;
  if (!isLast) {
    down = { x: cx(rooms[rooms.length - 1]), y: cy(rooms[rooms.length - 1]) };
    if (grid[down.y][down.x] === T.FLOOR || grid[down.y][down.x] === T.DEN) {
      grid[down.y][down.x] = T.DOWN;
    } else {
      grid[down.y][down.x] = T.DOWN;
    }
  }

  const dLevel = (state && state.player && state.player.level) || 1;
  const monsterPool = opts.monsterPool && opts.monsterPool.length ? opts.monsterPool : null;

  const monsters = [];
  const monsterCount = 7 + floorIdx * 4 + rng.int(0, 3);
  for (let i = 0; i < monsterCount; i++) {
    const t = monsterPool ? rng.pick(monsterPool) : opts.pickMonster && opts.pickMonster(floorIdx, rng);
    if (!t) continue;
    const pos = findSpot(grid, rooms, up, rng, 6);
    if (!pos) continue;
    monsters.push(scaledMonster(t, pos, dLevel, floorIdx, false));
  }

  const boss = opts.boss;
  if (boss && den) {
    const pay = {
      x: den.x + Math.floor(den.w / 2) + 2,
      y: den.y + Math.floor(den.h / 2),
    };
    if (grid[pay.y][pay.x] === T.DEN) {
      monsters.push(scaledMonster(boss, pay, dLevel, floorIdx, true));
    }
  }

  const items = [];
  const itemCount = 4 + rng.int(0, 3);
  for (let i = 0; i < itemCount; i++) {
    const it = opts.pickItem ? opts.pickItem(floorIdx, rng) : null;
    if (!it) continue;
    const pos = findSpot(grid, rooms, up, rng, 3);
    if (!pos) continue;
    items.push({ i: it, x: pos.x, y: pos.y, auto: it.kind === 'special' });
  }

  if (boss && den) {
    const tpos = { x: den.x + Math.floor(den.w / 2) - 2, y: den.y + Math.floor(den.h / 2) };
    if (grid[tpos.y][tpos.x] === T.DEN) {
      items.push({ i: opts.makeTreasure ? opts.makeTreasure(floorIdx, rng) : null, x: tpos.x, y: tpos.y, auto: true });
    }
  }

  const npcs = [];
  for (const tpl of (opts.npcs || [])) {
    const pos = findSpot(grid, rooms, up, rng, 2);
    if (pos) npcs.push({ tpl, x: pos.x, y: pos.y });
  }

  return { w: W, h: H, tiles: grid, rooms, monsters, items, npcs, up, down, theme, seed, isLast, den, boss };
}

function scaledMonster(t, pos, dLevel, floorIdx, boss) {
  const mul = 1 + Math.max(0, dLevel - 1) * 0.2 + floorIdx * 0.16 + (Number.isFinite(t.tierMul) ? t.tierMul : 0) * 0.15;
  const hp = Math.max(1, Math.round((t.hpMax || 8) * mul * (boss ? 4 : 1)));
  const dmgBonus = ((t.damage && t.damage.bonus) || 0) + Math.floor(floorIdx / 2) + (boss ? 1 : 0);
  return {
    t,
    x: pos.x, y: pos.y,
    hp, maxhp: hp,
    boss,
    aggro: false,
    acted: false,
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
