/* RECOVERY PACING AND THE LINE.
 *
 * Two reports from the same playtest. Out-of-combat health came back at a
 * point per step — the max(1, ...) floor under the regen fraction IS the rate
 * for any character under ~100 max health, so a stroll healed a level-1 party
 * to full in two dozen steps. And a mage at the reins opened every corridor
 * fight as the party's point, because marching stance cannot pass anyone in a
 * one-wide hall. The first is now paced to a tenth (one grant every tenth
 * calm tick); the second is fixed at combat's opening instant, when adjacent
 * members trade places until the steel stands nearer the foe than the robes. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H } from '../public/js/mapgen.js';
import { newGame } from './helpers.mjs';
import { makePlayer, initialStats } from '../public/js/engine.js';

/* A one-wide corridor along y=10, so nobody can pass anybody. */
function corridor(g) {
  const grid = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let x = 5; x < 30; x++) grid[10][x] = T.FLOOR;
  g.currentFloor = {
    w: W, h: H, tiles: grid, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 6, y: 10 }, down: null, altar: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
}

function foeAt(g, x, y) {
  const m = {
    t: { id: 'pest', name: 'Pest', glyph: 'p', tier: 0, hpMax: 9, ac: 10, toHit: 0,
         damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
         props: [], speed: 1, aggroRange: 40 },
    x, y, hp: 9, maxhp: 9, boss: false, aggro: true,
    toHit: 0, dmg: { dice: 1, sides: 1, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
    revealed: true, lastSeen: 0,
  };
  g.currentFloor.monsters.push(m);
  return m;
}

/* ---- recovery pacing ---- */

test('calm health returns on the tenth tick, not every tick', () => {
  const g = newGame('regen-pace');
  corridor(g);
  const p = g.state.player;
  p.x = 10; p.y = 10;
  p.hp = 1;
  assert.ok(g.outOfCombat(), 'an empty floor should be calm');
  for (let i = 0; i < 9; i++) g.tickStatus();
  assert.equal(p.hp, 1, 'health came back before the tenth calm tick');
  g.tickStatus();
  const grant = Math.max(1, Math.ceil(p.maxhp * 0.01));
  assert.equal(p.hp, 1 + grant, 'the tenth tick did not grant the point');
});

test('power still returns every calm tick', () => {
  const g = newGame('power-pace', 'mage');
  corridor(g);
  const p = g.state.player;
  p.x = 10; p.y = 10;
  p.power = 0;
  g.tickStatus();
  assert.ok(p.power > 0, 'power no longer trickles back per tick');
});

/* ---- the line forms ---- */

function marchingPair(g) {
  /* The mage holds the reins at the head of a single-file column; the
   * fighter is the follower directly behind. */
  const mage = g.state.party.members[0];
  mage.x = 12; mage.y = 10;
  const fighter = makePlayer('Steel', 'fighter', initialStats('fighter'));
  fighter.x = 11; fighter.y = 10;
  fighter.dungeonId = mage.dungeonId;
  fighter.depth = mage.depth;
  g.state.party.members.push(fighter);
  return { mage, fighter };
}

test('when calm breaks, the fighter shoulders past the mage', () => {
  const g = newGame('line-forms', 'mage');
  corridor(g);
  const { mage, fighter } = marchingPair(g);
  foeAt(g, 16, 10);
  assert.ok(!g.outOfCombat(), 'the foe should have broken the calm');
  g.buildRound();
  assert.deepEqual([fighter.x, fighter.y], [12, 10], 'the fighter did not take point');
  assert.deepEqual([mage.x, mage.y], [11, 10], 'the mage did not fall back');
  assert.match(g.logs.join(' '), /line forms/i, 'the exchange happened silently');
});

test('the line forms once, at the opening, not every round', () => {
  const g = newGame('line-once', 'mage');
  corridor(g);
  const { mage, fighter } = marchingPair(g);
  foeAt(g, 16, 10);
  g.buildRound();
  /* Mid-fight the player deliberately walks the mage forward; the next
   * round must respect that. */
  mage.x = 13; mage.y = 10;
  g._round = null;
  g.buildRound();
  assert.deepEqual([mage.x, mage.y], [13, 10], 'a mid-fight round re-formed the line');
  assert.deepEqual([fighter.x, fighter.y], [12, 10]);
});

test('a mage already behind stays where she is', () => {
  const g = newGame('line-held', 'mage');
  corridor(g);
  const { mage, fighter } = marchingPair(g);
  /* Reverse the column: fighter ahead, as stance wants it. */
  fighter.x = 13; fighter.y = 10;
  mage.x = 12; mage.y = 10;
  foeAt(g, 16, 10);
  g.logs.length = 0;
  g.buildRound();
  assert.deepEqual([fighter.x, fighter.y], [13, 10]);
  assert.deepEqual([mage.x, mage.y], [12, 10]);
  assert.ok(!/line forms/i.test(g.logs.join(' ')), 'the line formed with nothing to fix');
});
