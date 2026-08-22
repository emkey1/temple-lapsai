/* Content integrity: every id a dungeon names has to resolve. A dangling id used
 * to be swallowed silently, which cost The Upper Reaches its boss and locked
 * the third dungeon out of the game. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DUNGEONS, MONSTERS, ALL_ITEMS, getMonster } from '../public/js/base.js';

test('every dungeon monster pool resolves', () => {
  for (const d of DUNGEONS) {
    for (const id of d.monsterWeights || []) {
      assert.ok(getMonster(id), `dungeon "${d.id}" lists unknown monster id "${id}"`);
    }
  }
});

test('every dungeon has a boss that exists', () => {
  for (const d of DUNGEONS) {
    assert.ok(d.bossId, `dungeon "${d.id}" has no bossId`);
    assert.ok(getMonster(d.bossId), `dungeon "${d.id}" names unknown boss "${d.bossId}"`);
  }
});

test('every dungeon can draw monsters that are not its own boss', () => {
  for (const d of DUNGEONS) {
    const pool = (d.monsterWeights || []).filter((id) => id !== d.bossId);
    assert.ok(pool.length >= 3, `dungeon "${d.id}" has only ${pool.length} non-boss monsters`);
  }
});

test('monster and item ids are unique', () => {
  const mIds = MONSTERS.map((m) => m.id);
  assert.equal(new Set(mIds).size, mIds.length, 'duplicate monster id');
  const iIds = ALL_ITEMS.map((i) => i.id);
  assert.equal(new Set(iIds).size, iIds.length, 'duplicate item id');
});
