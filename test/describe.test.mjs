/* Every item in the game carries its rules on it, and until now none of them
 * showed. The bar this file holds is: if the engine reads an effect, the
 * player can read it too — otherwise choosing what to wear is a coin toss with
 * extra steps. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ALL_ITEMS, getItemTemplate } from '../public/js/base.js';
import { itemDescription, itemEffectLines, dieText } from '../public/js/describe.js';
import { deepItem, applyMagic, applyCurse } from '../public/js/dice.js';

test('every item in the game says what it does', () => {
  for (const it of ALL_ITEMS) {
    const d = itemDescription(it);
    assert.ok(d, `${it.name} shows the player nothing at all`);
  }
});

test('an enchantment hides until read, then shows in full', () => {
  const magic = applyMagic(deepItem(getItemTemplate('broadsword')), 2);
  /* Unread: it claims to be a plain broadsword with a rune on it. */
  const before = itemDescription(magic);
  assert.doesNotMatch(before, /\+2/, 'the enchantment leaked through the rules text');
  assert.match(before, /rune you cannot read/);
  assert.match(before, /1d8 damage/, 'the base claim went missing');
  assert.equal(magic.name, 'Broadsword', 'the plus leaked into the name');

  /* Read: the true name and the true numbers. */
  magic.identified = true;
  magic.name = magic.trueName;
  const after = itemDescription(magic);
  assert.match(after, /\+2 to hit/);
  assert.match(after, /1d8\+2 damage/);
});

test('the Lucky Coin finally explains itself', () => {
  const d = itemDescription(getItemTemplate('amulet-luck'));
  assert.match(d, /\d+%/, 'the coin still does not say what it buys you');
});

test('a curse hides with the enchantment, and shows once known', () => {
  /* An unread curse wears the same rune as a blessing — the description must
   * not give it away, and neither may the effects, which run the other way. */
  const trap = applyCurse(deepItem(getItemTemplate('broadsword')), 2);
  const before = itemDescription(trap);
  assert.doesNotMatch(before, /curse|accursed|-2/i, 'the curse announced itself');
  assert.match(before, /rune you cannot read/);

  trap.identified = true;
  trap.name = trap.trueName;
  const after = itemDescription(trap);
  assert.match(after, /cursed — it will not come off/i);
  assert.match(after, /-2 to hit/, 'the true numbers stayed hidden after reading');
});

/* The thing that rots: someone adds an effect to an item, the engine grows a
 * branch to read it, and the description quietly does not mention it. */
test('no item carries an effect the description cannot name', () => {
  const known = new Set();
  for (const it of ALL_ITEMS) {
    for (const k of Object.keys(it.effects || {})) known.add(k);
  }
  for (const k of known) {
    const probe = { name: 'Probe', kind: 'misc', effects: { [k]: pick(k) } };
    assert.ok(itemEffectLines(probe).length, `nothing describes the effect "${k}"`);
  }
});

/* And the mirror of it: an effect the engine acts on that no item happens to
 * carry yet is still an effect the oracle may write. */
test('every effect the validator accepts can be described', () => {
  const src = fs.readFileSync(new URL('../lib/expansion.js', import.meta.url), 'utf8');
  const validated = [...src.matchAll(/if \('(\w+)' in e\)/g)].map((m) => m[1]);
  assert.ok(validated.length > 5, 'the validator stopped looking like itself');
  for (const k of validated) {
    if (k === 'property') continue;   /* free text, described verbatim */
    const probe = { name: 'Probe', kind: 'misc', effects: { [k]: pick(k) } };
    assert.ok(itemEffectLines(probe).length, `the oracle may write "${k}" and the player would never see it`);
  }
});

test('dice read the way the rest of the game writes them', () => {
  assert.equal(dieText({ dice: 2, sides: 6, bonus: 0 }), '2d6');
  assert.equal(dieText({ dice: 1, sides: 8, bonus: 1 }), '1d8+1');
  assert.equal(dieText({ dice: 1, sides: 8, bonus: -1 }), '1d8-1');
  assert.equal(dieText('2d4+2'), '2d4+2');
  assert.equal(dieText(undefined), '');
});

function pick(key) {
  if (key === 'damage') return { dice: 1, sides: 6, bonus: 0 };
  if (key === 'statBonus') return { str: 1 };
  if (key === 'spell') return 'firebolt';
  if (key === 'seeSecrets') return true;
  if (key === 'removeCurse' || key === 'identify' || key === 'teleport' || key === 'map') return true;
  if (key === 'heal' || key === 'flame') return '2d4+2';
  return 2;
}
