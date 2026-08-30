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
  /* A monster carries no colour at all — the map tints it from its tier — so
   * an oracle that sends one is ignored rather than obeyed. */
  assert.equal(validateMonster({ name: 'X', color: 'gold' }).color, undefined);
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
  assert.ok(!monster.includes('"color":string'), 'the monster schema still asks for a colour it will not use');

  const item = buildPrompt('item', {});
  for (const k of ITEM_KINDS) assert.ok(item.includes(`"${k}"`), `prompt never mentions kind ${k}`);
  for (const c of PALETTE) assert.ok(item.includes(c), `prompt never mentions colour ${c}`);
  assert.ok(!item.includes('"black"'), 'prompt still offers black-on-black');

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

/* WHAT THE ORACLE IS TOLD ABOUT THE WORLD.
 *
 * The Library used to write for a generic 1982 module: the only world context
 * it ever received was a comma-separated list of dungeon NAMES, while seven
 * hundred lines of history, seven factions and three story arcs sat unread.
 * These pin the briefing — that it is built FROM the lore rather than beside
 * it, so it cannot go stale, and that it reaches the prompt.
 */

import { loreBriefing, WORLD } from '../public/js/world.js';

test('the briefing is built from the lore, not written beside it', () => {
  const b = loreBriefing();
  for (const f of WORLD.factions) {
    assert.ok(b.includes(f.name), 'the briefing does not mention ' + f.name);
  }
  for (const h of WORLD.history) {
    assert.ok(b.includes(h.era), 'the briefing skips the era ' + h.era);
  }
  for (const n of WORLD.npcs) {
    assert.ok(b.includes(n.name), 'the briefing forgets ' + n.name);
  }
});

test('and it carries the REGISTER, which is the part a model gets wrong first', () => {
  /* Facts without tone produce high fantasy written over the top of them. */
  const b = loreBriefing().toLowerCase();
  for (const word of ['debts', 'ledgers', 'owed']) {
    assert.ok(b.includes(word), 'the briefing does not teach the voice: missing "' + word + '"');
  }
});

test('it stays inside its budget, and trims whole entries', () => {
  const b = loreBriefing({ budget: 400 });
  assert.ok(b.length <= 400, `briefing ran to ${b.length} characters against a budget of 400`);
  /* A briefing cut mid-sentence teaches a model to write mid-sentence. */
  assert.ok(/\.$/.test(b.trim()), 'the briefing was cut mid-sentence');
});

test('the prompt carries the world, and says not to parrot it back', () => {
  const p = buildPrompt('dungeon', { lore: loreBriefing() });
  assert.ok(p.includes('THE WORLD THIS BELONGS TO'), 'the world never reached the prompt');
  assert.ok(/do not restate this back/i.test(p), 'nothing stops it echoing the briefing as flavour');
  assert.ok(p.includes('The Tallymen of the Whetstone'), 'the factions did not travel');
});

test('a named source borrows the logic and is forbidden the cast', () => {
  /* "In the manner of Alice in Wonderland" should produce this world's
   * version of that book's logic, not a crossover. */
  const p = buildPrompt('dungeon', { source: 'Alice in Wonderland' });
  assert.ok(p.includes('Alice in Wonderland'), 'the source never reached the prompt');
  assert.ok(/NOT its characters, names or plot/i.test(p),
    'nothing forbids it lifting the cast — a Cheshire Cat in the Whetstone is a costume');
});

test('no world and no source leaves the prompt as it was', () => {
  const p = buildPrompt('item', {});
  assert.ok(!p.includes('THE WORLD THIS BELONGS TO'));
  assert.ok(!p.includes('DRAW ON:'));
});

/* A NAME ALONE IS NOT A MONSTER.
 *
 * The dungeon prompt asked for "MONSTER objects" and never said what one was
 * — those schemas were only ever emitted for their own commissions. So the
 * model wrote {name} and nothing else, the validator filled the rest with
 * flat defaults, and the first dungeon generated came back with a tier-12
 * boss on ten hit points, a d6, and no flavour: every stat a default wearing
 * a magnificent name.
 */

test('the dungeon prompt defines the objects it asks for', () => {
  const p = buildPrompt('dungeon', {});
  for (const field of ['"hpMax":int', '"ac":int', '"props":', '"flavor":string']) {
    assert.ok(p.includes(field), 'the dungeon prompt never defines a monster: missing ' + field);
  }
  for (const field of ['"acBonus":int', '"cursed":bool', '"effects":']) {
    assert.ok(p.includes(field), 'the dungeon prompt never defines an item: missing ' + field);
  }
  assert.ok(/FILL IN EVERY FIELD/i.test(p), 'nothing tells it a name is not a monster');
});

test('and an under-specified monster still arrives at the depth it claimed', () => {
  /* Only what a terse model actually wrote: a name and a tier. */
  const boss = validateMonster({ name: 'The Garrison Commander', tier: 12 });
  assert.ok(boss.hpMax > 90, `a tier-12 boss came back on ${boss.hpMax} hit points`);
  assert.ok(boss.ac <= 4, `a tier-12 boss came back at AC ${boss.ac}`);
  assert.ok(boss.damage.dice > 1, 'a tier-12 boss came back swinging one die');
  assert.ok(boss.xp > 300, `a tier-12 boss was worth ${boss.xp} experience`);

  const rat = validateMonster({ name: 'Something Small', tier: 0 });
  assert.ok(rat.hpMax <= 6, `a tier-0 creature came back on ${rat.hpMax} hit points`);
  assert.ok(rat.hpMax < boss.hpMax / 10, 'the curve does not separate a rat from a wyrm');
});

test('but anything the model DID say still beats the default', () => {
  const m = validateMonster({ name: 'Glass Thing', tier: 12, hpMax: 4, ac: 12, xp: 7 });
  assert.equal(m.hpMax, 4, 'the validator overrode a deliberate choice');
  assert.equal(m.ac, 12);
  assert.equal(m.xp, 7);
});

test('the defaults sit near the shipped bestiary rather than inventing a curve', async () => {
  const { MONSTERS } = await import('../public/js/base.js');
  for (const id of ['rat', 'goblin', 'ettin']) {
    const real = MONSTERS.find((x) => x.id === id);
    const guess = validateMonster({ name: 'x', tier: real.tier });
    const ratio = guess.hpMax / real.hpMax;
    assert.ok(ratio > 0.6 && ratio < 1.8,
      `at tier ${real.tier} the default is ${guess.hpMax} hp against ${real.name}'s ${real.hpMax}`);
  }
});

test('a written sanctum may not be gentler than what the company has cleared', () => {
  const raw = { name: 'A Stroll', threat: 1, boss: { name: 'Something', tier: 13 } };
  assert.equal(validateDungeon(raw).threat, 1, 'the floor applies when nobody asked for one');
  assert.equal(validateDungeon(raw, { minThreat: 6 }).threat, 6, 'a generous model handed a post-game party a stroll');
  /* And a dramatic one cannot be talked up past the ceiling either. */
  assert.ok(validateDungeon({ ...raw, threat: 999 }, { minThreat: 6 }).threat <= 20);
});

test('the minimum level is derived from the boss, not claimed by the model', () => {
  const d = validateDungeon({ name: 'X', minLevel: 1, boss: { name: 'B', tier: 13 } });
  assert.equal(d.minLevel, 12, 'a model talked its way past the level gate');
  /* Against the shipped three: bosses at tier 7, 9 and 12, measured as tuned
   * for levels 5-7, 8-10 and 11-13. */
  assert.equal(validateDungeon({ name: 'X', boss: { name: 'B', tier: 9 } }).minLevel, 8);
  assert.equal(validateDungeon({ name: 'X', boss: { name: 'B', tier: 12 } }).minLevel, 11);
});
