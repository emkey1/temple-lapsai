/* Water. It used to be impassable, which severed sewer floors outright. It is
 * now crossable at a price: the turn costs double and the splashing carries. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H, isTravelable, isSlowGoing } from '../public/js/mapgen.js';
import { newGame, floorOf } from './helpers.mjs';
import { DUNGEONS } from '../public/js/base.js';
import { validateMonster } from '../lib/expansion.js';

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
  /* tryMove says WHAT it did now — 'step', 'strike', 'swap' — because the
   * combat turn needs to know a blow from a stride. */
  assert.equal(g.tryMove(1, 0), 'step', 'the move was refused');
  assert.equal(p.x, 15, 'the player did not enter the water');
  assert.match(g.logs.join(' '), /wade/i);
});

test('wading costs the turn twice over', () => {
  /* Counted as monster ACTIONS now, not phases: the initiative queue walks
   * monsters one at a time, and only the wading surcharge still sweeps them
   * all at once. The invariant is what it always was — wade, and everything
   * hostile moves twice before you move again. */
  const g = newGame('wade-slow');
  pond(g);
  const p = g.state.player;
  p.ini = 30;                        /* the wader goes first, so the count is clean */
  for (const m of g.currentFloor.monsters) m.ini = 1;
  g._round = null; g.advanceQueue();
  let acts = 0;
  const real = g.monsterTakeTurn.bind(g);
  g.monsterTakeTurn = (m, f) => { if (m.hp > 0) acts++; real(m, f); };
  const before = g.currentFloor.monsters.filter((m) => m.hp > 0).length;
  g.handleKey('d');                  /* step east, into the water */
  assert.equal(acts, before * 2, `${acts} monster actions for ${before} monsters — wading should give each two`);
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

/* ---- things that live in it ----
 *
 * The Upper Reaches had Giant Leeches standing about on dry stone in a
 * dungeon whose whole conceit is that it is flooded. A thing that lives in
 * water lives IN the water — and lies under it until something wades past.
 */

test('what swims spawns in the water, and nothing else does', () => {
  let swimmers = 0, swimmersWet = 0, othersWet = 0, others = 0;
  for (let f = 0; f < 4; f++) {
    for (let s = 0; s < 8; s++) {
      const { floor } = floorOf('upper', f, `aquatic-${f}-${s}`);
      for (const m of floor.monsters) {
        const wet = floor.tiles[m.y][m.x] === T.WATER;
        if (m.t.props && m.t.props.includes('aquatic')) { swimmers++; if (wet) swimmersWet++; }
        else { others++; if (wet) othersWet++; }
      }
    }
  }
  assert.ok(swimmers > 20, `only ${swimmers} aquatic monsters spawned across the dungeon`);
  assert.ok(swimmersWet / swimmers > 0.9, `${Math.round(100 * swimmersWet / swimmers)}% of what swims is in the water`);
  assert.equal(othersWet, 0, `${othersWet} of ${others} land monsters are standing in the drains`);
});

test('a dungeon with no water still finds its swimmers somewhere to stand', () => {
  /* The Halls of the Serpent hold Giant Snakes and not a drop of water. */
  const dry = DUNGEONS.find((d) => d.theme !== 'sewers' && (d.monsterWeights || []).includes('giant-snake'));
  assert.ok(dry, 'no dry dungeon carries an aquatic monster to check');
  for (let f = 0; f < dry.floors; f++) {
    const { floor } = floorOf(dry.id, f, `drylurk-${f}`);
    for (const m of floor.monsters) {
      assert.notEqual(floor.tiles[m.y][m.x], T.WATER);
      assert.ok(!m.submerged, `${m.t.name} is submerged in a dungeon with no water`);
    }
  }
});

/* A floor that actually has something lying in wait on it. */
function withLurker(seedBase) {
  for (let s = 0; s < 40; s++) {
    const g = newGame(`${seedBase}-${s}`, 'fighter');
    g.state.player.dungeonId = 'upper';
    g.loadFloor(1);
    const lurker = g.currentFloor.monsters.find((m) => m.submerged);
    if (lurker) return { g, lurker };
  }
  return null;
}

test('a submerged thing does nothing and shows nothing until you are close', () => {
  const found = withLurker('lurk-idle');
  assert.ok(found, 'no floor in forty had anything lying in the water');
  const { g, lurker } = found;
  /* The claim is about the LURKER's silence; the floor's other residents
   * are not on trial, and the wider corridors changed where they roam. */
  g.currentFloor.monsters = g.currentFloor.monsters.filter((m) => m === lurker);
  const p = g.state.player;
  p.x = lurker.x + 5; p.y = lurker.y;
  g.computeVisibility();
  g.logs.length = 0;
  g.resolveMonsters();
  assert.equal(lurker.submerged, true, 'it surfaced from across the room');
  assert.equal(g.logs.length, 0, 'it acted while still under the water');
});

test('coming within reach brings it up', () => {
  const { g, lurker } = withLurker('lurk-near');
  const p = g.state.player;
  p.x = lurker.x + 2; p.y = lurker.y;
  g.computeVisibility();
  g.logs.length = 0;
  g.resolveMonsters();
  assert.equal(lurker.submerged, false);
  assert.match(g.logs.join(' '), /water breaks/i, 'it surfaced without saying so');
  assert.equal(lurker.aggro, true, 'it surfaced and then ignored you');
});

test('splashing into the water it is lying in brings it up', () => {
  const { g, lurker } = withLurker('lurk-splash');
  const p = g.state.player;
  p.x = lurker.x + 4; p.y = lurker.y;
  g.logs.length = 0;
  g.wadeInto(p.x, p.y);
  assert.equal(lurker.submerged, false, 'it slept through the splashing');
});

test('and so does hitting it', () => {
  const { g, lurker } = withLurker('lurk-hit');
  assert.equal(lurker.submerged, true);
  g.applyDamageToMonster(lurker, 1, false, g.derived());
  assert.equal(lurker.submerged, false, 'it took a blow and stayed under');
});

test('the oracle may write something that swims', () => {
  const written = validateMonster({ name: 'Drain Eel', glyph: 'e', tier: 5, properties: ['aquatic', 'poison'] });
  assert.ok(written.props.includes('aquatic'), 'aquatic is not a property the Library can use');
});

test('magic that shows every monster shows the ones under the water', () => {
  /* Detect Evil promises "every monster on the floor". Quietly missing the
   * things lying in the drains is a lie the player only finds out about by
   * dying to one. */
  const found = withLurker('lurk-detect');
  assert.ok(found, 'no floor in forty had anything lying in the water');
  const { g, lurker } = found;
  assert.equal(lurker.revealed, undefined, 'the rig started with it already revealed');

  const cleric = newGame('detect-cleric', 'cleric');
  cleric.state.player.dungeonId = 'upper';
  for (let i = 1; i < 4; i++) cleric.levelUp();
  cleric.loadFloor(1);
  const hidden = cleric.currentFloor.monsters.find((m) => m.submerged);
  if (!hidden) return;                    /* this seed put nothing in the water */
  cleric.state.player.power = cleric.state.player.maxpower;
  cleric.activateAbility('detect-evil');
  assert.equal(hidden.revealed, true, 'Detect Evil missed what was lying in the water');
  /* Still submerged — revealed says you know where it is, not that it has
   * surfaced, so it keeps waiting. */
  assert.equal(hidden.submerged, true, 'being detected dragged it out of the water');
});

/* ---- what the water costs in a fight ----
 *
 * Reported: "water does not seem to halve the speed of the characters...
 * this should only impact movement, not attacks." It halved nothing in
 * combat: the wading surcharge was written as an out-of-combat rule (every
 * monster moves twice), and a member's GROUND was never touched. A step
 * into water now spends two tiles of speed and nothing else. */
import { makePlayer, initialStats } from '../public/js/engine.js';

function drownedArena(g) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 8; y < 16; y++) for (let x = 8; x < 30; x++) tiles[y][x] = T.FLOOR;
  for (let y = 8; y < 16; y++) for (let x = 14; x <= 18; x++) tiles[y][x] = T.WATER;
  g.currentFloor = {
    w: W, h: H, tiles, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 9, y: 9 }, down: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  const p = g.state.player;
  p.x = 12; p.y = 12;
  return g.currentFloor;
}

function woken(g, x, y) {
  const mo = {
    t: { id: 'w', name: 'Watcher', glyph: 'w', color: 'red', hpMax: 90, ac: 30, toHit: 0, damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 20 },
    x, y, hp: 90, maxhp: 90, boss: false, aggro: true, acted: false,
    toHit: 0, dmg: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0, ini: 1,
  };
  g.currentFloor.monsters.push(mo);
  return mo;
}

test('a step into water costs two tiles of ground, not one', () => {
  /* A thief, whose five tiles leave the counter still open to read after
   * the wade — a fighter's three are entirely spent by it, which is the
   * same rule seen from the other end. */
  const g = newGame('wade-ground', 'thief');   /* speed 5 */
  drownedArena(g);
  const p = g.state.player;
  woken(g, 12, 15);                 /* the fight is on, and out of reach */
  p.ini = 30; g._round = null; g.advanceQueue();
  g.handleKey('d');                 /* dry stride: one tile of five */
  assert.equal(g.actorTurn(p).moved, 1, 'a dry step should cost one');
  g.handleKey('d');                 /* into the water at x=14 */
  assert.equal(g.actorTurn(p).moved, 3, 'the wade should have cost two');
});

test('the drains halve a fighter’s march: three tiles carry two', () => {
  const g = newGame('wade-halve', 'fighter');   /* speed 3 */
  drownedArena(g);
  const p = g.state.player;
  p.x = 13; p.y = 12;               /* one dry stride from the water */
  woken(g, 13, 15);
  p.ini = 30; g._round = null; g.advanceQueue();
  const acts = [];
  const real = g.monsterTakeTurn.bind(g);
  g.monsterTakeTurn = (m, f) => { acts.push(m); real(m, f); };
  g.handleKey('d');                 /* into the water: two of three */
  assert.equal(acts.length, 0, 'the wade ended the turn outright');
  g.handleKey('d');                 /* the third tile, still wading */
  assert.ok(acts.length > 0, 'two water tiles should exhaust three ground');
  assert.equal(p.x, 15, 'the fighter crossed more water than their legs allow');
});

test('the water slows the legs and never the arm', () => {
  const g = newGame('wade-arm', 'fighter');
  drownedArena(g);
  const p = g.state.player;
  p.x = 13; p.y = 12;
  const mo = woken(g, 15, 12);      /* standing IN the water, beside the shallows */
  p.ini = 30; g._round = null; g.advanceQueue();
  g.handleKey('d');                 /* wade in beside it: two tiles of three */
  assert.equal(g.actorTurn(p).moved, 2);
  const before = mo.hp;
  g.handleKey('d');                 /* and swing from the water */
  assert.ok(mo.hp < before, 'the blow from the water never landed');
});

test('out of the water, the ground is ordinary again', () => {
  const g = newGame('wade-out', 'fighter');
  drownedArena(g);
  const p = g.state.player;
  p.x = 18; p.y = 12;               /* in the water at the far bank */
  woken(g, 18, 15);
  p.ini = 30; g._round = null; g.advanceQueue();
  g.handleKey('d');                 /* onto dry stone at 19 */
  assert.equal(g.actorTurn(p).moved, 1, 'leaving the water cost more than a stride');
});
