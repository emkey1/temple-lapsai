/* Water. It used to be impassable, which severed sewer floors outright. It is
 * now crossable at a price: the turn costs double and the splashing carries. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H, isTravelable, isSlowGoing } from '../public/js/mapgen.js';
import { newGame, floorOf } from './helpers.mjs';
import { DUNGEONS } from '../public/js/base.js';

function pond(g) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 5; y < 15; y++) for (let x = 5; x < 25; x++) tiles[y][x] = T.FLOOR;
  tiles[10][15] = T.WATER;
  g.currentFloor = {
    w: W, h: H, tiles, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 8, y: 10 }, down: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(false));
  g.state.player.x = 14;
  g.state.player.y = 10;
  return g.currentFloor;
}

test('water is crossable', () => {
  assert.equal(isTravelable(T.WATER), true);
  assert.equal(isSlowGoing(T.WATER), true);
});

test('you can wade into water', () => {
  const g = newGame('wade');
  pond(g);
  const p = g.state.player;
  assert.equal(g.tryMove(1, 0), true, 'the move was refused');
  assert.equal(p.x, 15, 'the player did not enter the water');
  assert.match(g.logs.join(' '), /wade/i);
});

test('wading costs the turn twice over', () => {
  const g = newGame('wade-slow');
  pond(g);
  let turns = 0;
  const realResolve = g.resolveMonsters.bind(g);
  g.resolveMonsters = () => { turns++; realResolve(); };
  g.handleKey('d');                  /* step east, into the water */
  assert.equal(turns, 2, `monsters acted ${turns} time(s) — wading should give them two`);
});

test('splashing wakes what is nearby, and only what is nearby', () => {
  const g = newGame('wade-loud');
  const floor = pond(g);
  const beast = (x, y) => ({
    t: { id: 't', name: 'Lurker', glyph: 'L', color: 'green', hpMax: 9, ac: 10, toHit: 0, damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 8 },
    x, y, hp: 9, maxhp: 9, boss: false, aggro: false, acted: false,
    toHit: 0, dmg: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, idx: x,
  });
  const near = beast(18, 10);        /* 3 tiles from the splash */
  const far = beast(24, 14);         /* 13 tiles away */
  floor.monsters.push(near, far);
  g.tryMove(1, 0);
  assert.equal(near.aggro, true, 'the nearby monster slept through the splashing');
  assert.equal(far.aggro, false, 'a monster across the level heard a splash');
});

/* ---- water worth the name ----
 *
 * Reported: "the water in the second dungeon is both sparse, and so far as I
 * can tell, pointless?" Both true, and the second followed from the first. It
 * was sprinkled a tile at a time on a 3.5% roll — about eighteen isolated
 * puddles on a floor, every one of them walkable around — so wading's costs
 * (the turn twice over, and everything within six tiles woken) were never a
 * decision anybody had to make.
 */

function wetStats(dungeonId, floorIdx, seeds = 12) {
  let water = 0, open = 0, biggest = 0, sunk = 0, items = 0;
  for (let s = 0; s < seeds; s++) {
    const { floor } = floorOf(dungeonId, floorIdx, `wet-${dungeonId}-${floorIdx}-${s}`);
    const flat = floor.tiles.flat();
    water += flat.filter((t) => t === T.WATER).length;
    open += flat.filter((t) => t !== T.WALL).length;
    for (const it of floor.items) { items++; if (floor.tiles[it.y][it.x] === T.WATER) sunk++; }

    /* The biggest connected body: one tile is a puddle, twenty is a drain. */
    const seen = new Set();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (floor.tiles[y][x] !== T.WATER || seen.has(y * W + x)) continue;
        let n = 0;
        const q = [[x, y]];
        seen.add(y * W + x);
        while (q.length) {
          const [cx, cy] = q.pop();
          n++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy, k = ny * W + nx;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(k)) continue;
            if (floor.tiles[ny][nx] !== T.WATER) continue;
            seen.add(k);
            q.push([nx, ny]);
          }
        }
        biggest = Math.max(biggest, n);
      }
    }
  }
  return { pct: 100 * water / open, biggest, sunkPct: 100 * sunk / Math.max(1, items) };
}

test('a drowned warren is actually drowned', () => {
  for (const d of DUNGEONS.filter((x) => x.theme === 'sewers')) {
    for (let f = 0; f < d.floors; f++) {
      const s = wetStats(d.id, f);
      assert.ok(s.pct >= 7, `${d.id} floor ${f + 1} is ${s.pct.toFixed(1)}% water — a puddle, not a warren`);
    }
  }
});

test('the water is in drains and pools, not confetti', () => {
  /* Eighteen isolated tiles are eighteen things to step around. One body of
   * twenty is a thing you cross or go the long way round. */
  const s = wetStats('upper', 2);
  assert.ok(s.biggest >= 10, `the largest body of water is ${s.biggest} tiles`);
});

test('there is more of it the deeper you go, because the tide comes in', () => {
  const first = wetStats('upper', 0).pct;
  const last = wetStats('upper', 3).pct;
  assert.ok(last >= first * 0.9, `the warren dries out as you descend: ${first.toFixed(1)}% to ${last.toFixed(1)}%`);
});

test('some of what is worth having is lying in it', () => {
  /* The payoff half. findSpot only ever returned plain floor, so nothing in
   * the game was ever in the water and there was no reason to go in. */
  const s = wetStats('upper', 1);
  assert.ok(s.sunkPct >= 8, `only ${s.sunkPct.toFixed(1)}% of the floor's items are in the water`);
});

test('a dungeon that is not a sewer stays dry', () => {
  for (const d of DUNGEONS.filter((x) => x.theme !== 'sewers')) {
    const s = wetStats(d.id, 1, 6);
    assert.equal(s.pct, 0, `${d.id} has water in it and is not a sewer`);
  }
});

test('the stairs and the doorways do not flood', () => {
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s < 8; s++) {
      const { floor } = floorOf('upper', f, `dry-${f}-${s}`);
      assert.notEqual(floor.tiles[floor.up.y][floor.up.x], T.WATER, 'the up-stairs are under water');
      if (floor.down) assert.notEqual(floor.tiles[floor.down.y][floor.down.x], T.WATER, 'the down-stairs are under water');
      if (floor.altar) assert.notEqual(floor.tiles[floor.altar.y][floor.altar.x], T.WATER, 'the altar is under water');
    }
  }
});
