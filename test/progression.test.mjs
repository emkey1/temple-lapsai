/* Progression: killing a boss has to clear its dungeon and open the next one,
 * and a save has to come back as the character that went in. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';

test('a fresh adventurer starts in the Temple with only the Temple open', () => {
  const g = newGame('start');
  assert.equal(g.state.player.dungeonId, 'temple');
  assert.deepEqual(g.availableDungeons().map((d) => d.id), ['temple']);
});

test('clearing each dungeon opens the next', () => {
  const g = newGame('unlock');
  const p = g.state.player;
  p.bossesSlain.temple = true;
  assert.deepEqual(g.availableDungeons().map((d) => d.id), ['temple', 'upper']);
  p.bossesSlain.upper = true;
  assert.deepEqual(g.availableDungeons().map((d) => d.id), ['temple', 'upper', 'serpent']);
});

test('killing the boss clears the dungeon', () => {
  const g = newGame('boss');
  const p = g.state.player;
  g.loadFloor(g.dungeonById('temple').floors - 1);
  const boss = g.currentFloor.monsters.find((m) => m.boss);
  assert.ok(boss, 'no boss on the final floor');
  g.killMonster(boss);
  assert.equal(p.bossesSlain.temple, true);
  assert.equal(g.isDungeonCleared('temple'), true);
});

test('clearing all three fires the Library hook exactly once', () => {
  let fired = 0;
  const g = newGame('all');
  g.opts.onAllBaseCleared = () => { fired++; };
  const p = g.state.player;
  for (const id of ['temple', 'upper', 'serpent']) {
    p.dungeonId = id;
    g.loadFloor(g.dungeonById(id).floors - 1);
    const boss = g.currentFloor.monsters.find((m) => m.boss);
    assert.ok(boss, `no boss in ${id}`);
    g.killMonster(boss);
  }
  assert.equal(fired, 1);
});

test('a save round-trips', () => {
  const g = newGame('save');
  const p = g.state.player;
  p.gold = 137;
  p.xp = 42;
  const saved = g.save();
  const g2 = newGame('save');
  g2.restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(g2.state.player.name, p.name);
  assert.equal(g2.state.player.gold, 137);
  assert.equal(g2.state.player.xp, 42);
  assert.equal(g2.state.player.cls, p.cls);
  g2.loadFloor(g2.state.player.floorIdx);
  assert.ok(g2.currentFloor, 'restored game could not load its floor');
});
