/* Colour carries meaning now: red is alive, everything else is scenery or
 * loot. That only holds if the two vocabularies never overlap, and the overlap
 * is exactly the kind of thing that creeps back one item at a time. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, PALETTE, MONSTER_TINTS, monsterTint, PLAYER_GLYPH } from '../public/js/contract.js';
import { MONSTERS, ALL_ITEMS, cls } from '../public/js/base.js';
import { validateMonster, validateItem } from '../lib/expansion.js';

test('every colour anything can be painted actually renders', () => {
  for (const c of [...PALETTE, ...MONSTER_TINTS]) {
    assert.ok(COLORS[c], `"${c}" is offered but has no hex`);
    assert.match(cls(c), /^#[0-9a-f]{6}$/i, `"${c}" does not resolve to a colour`);
  }
});

test('nothing the player can pick up is painted in a monster tint', () => {
  const tints = new Set(MONSTER_TINTS);
  for (const it of ALL_ITEMS) {
    assert.ok(!tints.has(it.color), `${it.name} is ${it.color} — red means something alive`);
    assert.ok(COLORS[it.color], `${it.name} has unpaintable colour "${it.color}"`);
  }
});

test('the palette offered to the oracle holds no monster tint', () => {
  for (const c of MONSTER_TINTS) {
    assert.ok(!PALETTE.includes(c), `the oracle may paint an item "${c}"`);
  }
});

test('monsters carry no colour of their own', () => {
  for (const m of MONSTERS) {
    assert.equal(m.color, undefined, `${m.id} still carries a hand-picked colour`);
  }
  assert.equal(validateMonster({ name: 'Gilded Thing', color: 'gold' }).color, undefined);
  /* Items still choose, because they are not the thing colour has to disambiguate. */
  assert.equal(validateItem({ name: 'Gem', kind: 'special', color: 'cyan' }).color, 'cyan');
});

test('the tint ramp is a ramp: hotter with depth, and it covers every tier', () => {
  const seen = [];
  for (let tier = 0; tier <= 15; tier++) {
    const t = monsterTint(tier);
    assert.ok(MONSTER_TINTS.includes(t), `tier ${tier} tints to "${t}", which is not on the ramp`);
    const idx = MONSTER_TINTS.indexOf(t);
    if (seen.length) assert.ok(idx >= seen[seen.length - 1], `tier ${tier} cooled off`);
    seen.push(idx);
  }
  assert.equal(monsterTint(0), MONSTER_TINTS[0], 'a sewer rat should be the dullest thing down there');
  assert.equal(monsterTint(15), MONSTER_TINTS[MONSTER_TINTS.length - 1]);
  assert.ok(seen[seen.length - 1] > seen[0], 'the ramp never climbs');
});

test('the bestiary uses the whole ramp, and a boss burns hotter than its kin', () => {
  const used = new Set(MONSTERS.map((m) => monsterTint(m.tier)));
  assert.equal(used.size, MONSTER_TINTS.length, `only ${used.size} of ${MONSTER_TINTS.length} tints ever appear`);
  const idx = (t) => MONSTER_TINTS.indexOf(t);
  assert.ok(idx(monsterTint(4, true)) > idx(monsterTint(4, false)), 'a boss looks like its underlings');
  assert.equal(monsterTint(15, true), MONSTER_TINTS[MONSTER_TINTS.length - 1], 'the ramp overflowed');
});

test('a rat and a great wyrm cannot be confused for each other', () => {
  assert.notEqual(monsterTint(0), monsterTint(12));
});

/* Colour separates loot from monsters, and glyph has to separate you from
 * them: the top of the ramp is pale enough that a monster drawn as '@' would
 * sit one shade off the white '@' that is you. */
test('nothing in the bestiary is drawn as the player', () => {
  for (const m of MONSTERS) {
    assert.notEqual(m.glyph, PLAYER_GLYPH, `${m.name} is drawn as the player`);
  }
  assert.equal(validateMonster({ name: 'Impostor', glyph: PLAYER_GLYPH }).glyph, PLAYER_GLYPH === '@' ? 'M' : PLAYER_GLYPH);
});
