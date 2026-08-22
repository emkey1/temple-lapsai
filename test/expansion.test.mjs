/* The validator, against the shapes an oracle actually returns. Every one of
 * these was a way for generated content to arrive broken or not at all. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMonster, validateItem, validateAbility, validateDungeon,
  validateExpansion, buildPrompt, extractJSON, dice, glyph, color,
} from '../lib/expansion.js';
import { PALETTE, COLORS, MONSTER_PROPS, ITEM_KINDS, DUNGEON_THEMES, ABILITY_KINDS, CLASS_IDS } from '../public/js/contract.js';

/* ---- the drift that made generated content inert ---- */

test('monsters keep their behaviour under the name the engine reads', () => {
  const m = validateMonster({ name: 'Bone Choir', properties: ['undead', 'ranged'] });
  assert.deepEqual(m.props, ['undead', 'ranged']);
  assert.equal(m.properties, undefined, 'still emitting the field nothing reads');
});

test('props are accepted under either input name', () => {
  assert.deepEqual(validateMonster({ name: 'A', props: ['flying'] }).props, ['flying']);
  assert.deepEqual(validateMonster({ name: 'B', properties: ['flying'] }).props, ['flying']);
});

test('unknown props are dropped rather than passed through', () => {
  const m = validateMonster({ name: 'C', props: ['undead', 'explodes', 'poison'] });
  assert.deepEqual(m.props, ['undead', 'poison']);
});

test('the die count survives — a 3d6 boss is not a 1d6 boss', () => {
  assert.deepEqual(validateMonster({ name: 'D', damage: { dice: 3, sides: 6, bonus: 2 } }).damage,
    { dice: 3, sides: 6, bonus: 2 });
  assert.deepEqual(validateItem({ name: 'Blade', kind: 'weapon', effects: { damage: { dice: 2, sides: 8 } } }).effects.damage,
    { dice: 2, sides: 8, bonus: 0 });
});

test('dice accept objects, bare numbers and "2d6+1" strings alike', () => {
  assert.deepEqual(dice({ dice: 2, sides: 10, bonus: 3 }), { dice: 2, sides: 10, bonus: 3 });
  assert.deepEqual(dice(8), { dice: 1, sides: 8, bonus: 0 });
  assert.deepEqual(dice('3d4+2'), { dice: 3, sides: 4, bonus: 2 });
  assert.deepEqual(dice(undefined), { dice: 1, sides: 6, bonus: 0 });
});

test('glyph case is preserved, since lowercase means a lesser creature', () => {
  assert.equal(glyph('k'), 'k');
  assert.equal(glyph('K'), 'K');
  assert.equal(glyph('@!'), '@');
  assert.equal(glyph(''), '?');
  assert.equal(glyph('🐀'), '?', 'non-ASCII would not render in the tileset');
});

test('every colour the prompt offers is a colour the validator accepts', () => {
  for (const c of PALETTE) assert.equal(color(c), c, `prompt offers "${c}" but the validator rejects it`);
});

test('every colour the validator accepts can actually be drawn', () => {
  for (const c of Object.keys(COLORS)) assert.match(COLORS[c], /^#[0-9a-f]{6}$/i, `${c} has no hex`);
});

test('abilities never carry NaN, which JSON turns into null', () => {
  const a = validateAbility({ name: 'Rive', kind: 'damage', damage: { sides: 8, bonus: 1 } });
  assert.equal(Number.isInteger(a.damage.dice), true);
  assert.equal(JSON.parse(JSON.stringify(a)).damage.dice, a.damage.dice);
});

test('abilities only carry the fields their kind needs', () => {
  const passive = validateAbility({ name: 'Sure-footed', kind: 'passive' });
  assert.equal(passive.aura, undefined, 'invented an aura for a passive');
  assert.equal(passive.damage, undefined, 'invented damage for a passive');

  const healer = validateAbility({ name: 'Mend', kind: 'heal', heal: { dice: 2, sides: 6 } });
  assert.deepEqual(healer.heal, { dice: 2, sides: 6, bonus: 0 });

  const blink = validateAbility({ name: 'Step', kind: 'teleport', range: 5 });
  assert.equal(blink.teleportRng, 5);
});

/* ---- refusing what the model should not be able to do ---- */

test('an item\'s slot comes from its kind, never from the model', () => {
  const it = validateItem({ name: 'Hat', kind: 'armor', slot: 'hat' });
  assert.equal(it.slot, 'body');
  const junk = validateItem({ name: 'Thing', kind: 'nonsense' });
  assert.equal(junk.kind, 'misc');
  assert.equal(junk.slot, 'misc');
});

test('numbers are clamped rather than trusted', () => {
  const m = validateMonster({ name: 'Colossus', hpMax: 999999, tier: 99, ac: -500, xp: -3 });
  assert.equal(m.hpMax, 4000);
  assert.equal(m.tier, 15);
  assert.equal(m.ac, -10);
  assert.ok(m.xp >= 1);
});

test('gold never comes back inverted', () => {
  const m = validateMonster({ name: 'Miser', goldMin: 90, goldMax: 10 });
  assert.ok(m.goldMax >= m.goldMin, `${m.goldMax} < ${m.goldMin}`);
});

test('unknown enums fall back instead of leaking through', () => {
  assert.equal(validateDungeon({ name: 'X', theme: 'volcano' }).theme, 'temple');
  assert.equal(validateAbility({ name: 'X', kind: 'summon' }).kind, 'passive');
  assert.equal(validateAbility({ name: 'X', cls: 'bard' }).cls, 'fighter');
  assert.equal(validateMonster({ name: 'X', color: 'chartreuse' }).color, 'white');
});

test('a garbage payload is refused, not half-built', () => {
  assert.throws(() => validateExpansion({ type: 'wizard' }), /unsupported/);
  assert.throws(() => validateExpansion(null), /unsupported/);
  assert.throws(() => validateMonster('a monster'), /payload missing/);
});

/* ---- whole-response round trips ---- */

test('a fenced dungeon response validates end to end', () => {
  const reply = '```json\n' + JSON.stringify({
    type: 'dungeon',
    dungeon: {
      name: 'The Sunken Fane', title: 'a drowned reliquary', flavor: 'Water remembers.',
      floors: 3, theme: 'sewers', threat: 3,
      monsters: [{ name: 'Fane Eel', glyph: 'e', color: 'teal', tier: 5, hpMax: 30, damage: { dice: 2, sides: 4 }, properties: ['poison'] }],
      items: [{ name: 'Silt Scale', kind: 'armor', glyph: '[', color: 'teal', effects: { acBonus: 3 } }],
      boss: { name: 'The Drowned Choir', glyph: 'C', color: 'cyan', tier: 9, hpMax: 140, damage: { dice: 3, sides: 6 }, properties: ['undead'] },
    },
  }) + '\n```';

  const d = validateExpansion(extractJSON(reply));
  assert.equal(d.type, 'dungeon');
  assert.equal(d.theme, 'sewers');
  assert.equal(d.monsters[0].glyph, 'e', 'lowercase glyph was upper-cased');
  assert.deepEqual(d.monsters[0].props, ['poison']);
  assert.deepEqual(d.boss.damage, { dice: 3, sides: 6, bonus: 0 }, 'the boss lost its dice');
  assert.deepEqual(d.boss.props, ['undead']);
  assert.equal(d.items[0].slot, 'body');
});

test('prose around the JSON does not defeat the parser', () => {
  const parsed = extractJSON('Certainly! Here you go:\n{"type":"item","item":{"name":"Ash Key"}}\nHope that helps.');
  assert.equal(validateExpansion(parsed).name, 'Ash Key');
});

/* ---- the prompt is generated from the contract, so it cannot drift ---- */

test('the prompt offers exactly the vocabulary the validator enforces', () => {
  const monster = buildPrompt('monster', {});
  for (const p of MONSTER_PROPS) assert.ok(monster.includes(`"${p}"`), `prompt never mentions prop ${p}`);
  for (const c of PALETTE) assert.ok(monster.includes(c), `prompt never mentions colour ${c}`);
  assert.ok(!monster.includes('"black"'), 'prompt still offers black-on-black');

  const item = buildPrompt('item', {});
  for (const k of ITEM_KINDS) assert.ok(item.includes(`"${k}"`), `prompt never mentions kind ${k}`);

  const dungeon = buildPrompt('dungeon', {});
  for (const t of DUNGEON_THEMES) assert.ok(dungeon.includes(`"${t}"`), `prompt never mentions theme ${t}`);

  const ability = buildPrompt('ability', {});
  for (const k of ABILITY_KINDS) assert.ok(ability.includes(`"${k}"`), `prompt never mentions kind ${k}`);
  for (const c of CLASS_IDS) assert.ok(ability.includes(`"${c}"`), `prompt never mentions class ${c}`);
});

test('the prompt uses the focus the player typed', () => {
  const prompt = buildPrompt('monster', { focus: 'a chitinous horror that sings' });
  assert.match(prompt, /chitinous horror that sings/);
});

test('the prompt pitches content at the player\'s level', () => {
  assert.match(buildPrompt('item', { depth: 7 }), /level 7/);
  assert.doesNotMatch(buildPrompt('item', {}), /around level/);
});

test('the ability prompt asks for the class that is asking', () => {
  assert.match(buildPrompt('ability', { cls: 'cleric' }), /ABILITY for a cleric/);
  assert.match(buildPrompt('ability', { cls: 'bard' }), /ABILITY for a fighter/);
});
