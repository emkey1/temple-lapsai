/* Water. It used to be impassable, which severed sewer floors outright. It is
 * now crossable at a price: the turn costs double and the splashing carries. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H, isTravelable, isSlowGoing } from '../public/js/mapgen.js';
import { newGame } from './helpers.mjs';

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
