/* THE WAYFINDER: how a click becomes a route.
 *
 * Pure function of what the player can SEE — it plans over remembered tiles
 * only, treats unexplored dark as wall, and never learns anything the map
 * has not shown. That rule is the whole ethics of a mouse in a dungeon
 * crawler: the pathfinder must not be a scout.
 *
 * Weighted, because terrain lies to hop-counters: water is crossable but
 * slow and loud, so it costs triple, and a closed door costs the bump that
 * opens it. Without the weights a click would happily wade the party
 * through a drowned shortcut, waking everything that sleeps in it, to save
 * one turn of dry corridor. DOM-free and engine-free on purpose: the whole
 * of it runs headless in tests.
 */

import { T, isTravelable } from './mapgen.js';

const STEP_COST = 2;        /* a plain stride, doubled so diagonals can cost 3 */
const DIAGONAL_COST = 3;    /* ~sqrt(2), in integers a bucket queue can hold */
const WATER_MULT = 3;       /* slow going, and the noise carries */
const DOOR_COST = 2;        /* the bump that opens it, then the step through */

function enterCost(tile, diagonal) {
  const base = diagonal ? DIAGONAL_COST : STEP_COST;
  if (tile === T.WATER) return base * WATER_MULT;
  if (tile === T.DOOR_C) return base + DOOR_COST;
  return base;
}

const DIRS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/* Finds a route from `from` to `to` over tiles the player has seen.
 *
 *   tiles    the floor's tile grid
 *   seen     the matching grid of what the player has explored
 *   from     {x, y} where the walker stands
 *   to       {x, y} where the click landed
 *   blocked  Set of 'x,y' keys the route may not pass through (monsters,
 *            townsfolk) — the destination itself is exempt, because walking
 *            AT a monster is how an attack is asked for
 *
 * Returns the steps as [{x, y}, ...] — excluding the start, including the
 * destination — or null when no seen route exists. A closed door on the
 * route is fine (one bump opens it); everything else impassable is a wall.
 */
export function findPath({ tiles, seen, from, to, blocked }) {
  if (!tiles || !from || !to) return null;
  const H = tiles.length, W = tiles[0].length;
  const inGrid = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  if (!inGrid(to.x, to.y) || !inGrid(from.x, from.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const wasSeen = (x, y) => !!(seen && seen[y] && seen[y][x]);
  const key = (x, y) => x + ',' + y;
  const isBlocked = (x, y) => blocked && blocked.has(key(x, y)) && !(x === to.x && y === to.y);
  const open = (x, y) => {
    const t = tiles[y][x];
    return isTravelable(t) || t === T.DOOR_C;
  };

  /* The destination must itself be somewhere a walker could stand — or the
   * home of whatever the click meant to reach, which `blocked` marks. */
  if (!wasSeen(to.x, to.y)) return null;
  if (!open(to.x, to.y) && !(blocked && blocked.has(key(to.x, to.y)))) return null;

  /* Dijkstra over small integer costs: an array of buckets stands in for the
   * priority queue, because every edge costs between 2 and 9. */
  const dist = new Map([[key(from.x, from.y), 0]]);
  const prev = new Map();
  const buckets = [[{ x: from.x, y: from.y }]];
  let at = 0, remaining = 1;

  while (remaining > 0 && at < buckets.length) {
    const bucket = buckets[at];
    if (!bucket || !bucket.length) { at++; continue; }
    const cur = bucket.pop();
    remaining--;
    const curKey = key(cur.x, cur.y);
    if ((dist.get(curKey) ?? Infinity) < at) continue;   /* stale entry */
    if (cur.x === to.x && cur.y === to.y) break;

    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inGrid(nx, ny) || !wasSeen(nx, ny) || isBlocked(nx, ny)) continue;
      const isDest = nx === to.x && ny === to.y;
      if (!open(nx, ny) && !isDest) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        /* The engine's corner rule: a diagonal step needs at least one of
         * the two tiles it slips between to be open, or it is a wall. */
        const side = tiles[cur.y][nx], over = tiles[ny][cur.x];
        if (!isTravelable(side) && !isTravelable(over)) continue;
      }
      const cost = (dist.get(curKey) || 0) + enterCost(tiles[ny][nx], diagonal);
      const nKey = key(nx, ny);
      if (cost >= (dist.get(nKey) ?? Infinity)) continue;
      dist.set(nKey, cost);
      prev.set(nKey, curKey);
      (buckets[cost] = buckets[cost] || []).push({ x: nx, y: ny });
      remaining++;
    }
  }

  const endKey = key(to.x, to.y);
  if (!prev.has(endKey) && endKey !== key(from.x, from.y)) return null;

  const path = [];
  for (let k = endKey; k !== key(from.x, from.y); k = prev.get(k)) {
    const [x, y] = k.split(',').map(Number);
    path.push({ x, y });
  }
  return path.reverse();
}
