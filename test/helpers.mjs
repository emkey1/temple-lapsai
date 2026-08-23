/* Shared rig for the headless tests. The engine has no DOM dependencies, so the
 * whole game runs in Node — that is what makes these invariants cheap to check. */

import { Game, initialStats } from '../public/js/engine.js';
import { T, W, H, isTravelable } from '../public/js/mapgen.js';

/* A Game with a silent UI, seeded so failures reproduce. */
export function newGame(seed = 'test', clsId = 'fighter') {
  const logs = [];
  const g = new Game({ ui: { log: (m) => logs.push(m) } });
  g.state.seed = seed;
  g.foundAdventurer('Tester', clsId, initialStats(clsId));
  g.logs = logs;
  return g;
}

/* The character inside a SAVED state — a JSON blob with no live accessor on
 * it. state.player is a non-enumerable getter onto the party, so it does not
 * survive the round trip and a save has to be asked for its members instead. */
export function savedPlayer(state) {
  if (!state) return null;
  if (state.party && Array.isArray(state.party.members)) {
    return state.party.members[state.party.active || 0] || null;
  }
  return state.player || null;   /* a save from before the party existed */
}

/* A save in the shape it had before the party existed: a plain `player` field
 * and no party. Restoring one has to still work, for ever. */
export function legacyShape(state) {
  const copy = JSON.parse(JSON.stringify(state));
  const who = savedPlayer(copy);
  delete copy.party;
  copy.player = who;
  return copy;
}

/* Every tile the player can get to on foot, given time and patience. Closed
 * doors open on a bump; secret doors open on a search, which always succeeds
 * eventually — and the boss den is behind one, so they have to count here even
 * though isTravelable() (correctly) treats them as wall until they are found. */
export function reachableFrom(floor, start) {
  const seen = new Set([start.y * W + start.x]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const key = y * W + x;
      if (seen.has(key)) continue;
      const t = floor.tiles[y][x];
      if (!isTravelable(t) && t !== T.DOOR_C && t !== T.SECRET) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}

export function canReach(floor, start, spot) {
  return reachableFrom(floor, start).has(spot.y * W + spot.x);
}

/* Load one floor of one dungeon under a given seed and hand back the floor. */
export function floorOf(dungeonId, floorIdx, seed) {
  const g = newGame(seed);
  g.state.player.dungeonId = dungeonId;
  g.loadFloor(floorIdx);
  return { g, floor: g.currentFloor };
}
