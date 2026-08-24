/* BOTH HANDS ARE BOTH HANDS.
 *
 * Reported: "I should not be able to wear a tower shield (or any shield) and
 * wield a two handed sword." There was no concept of hands at all — the weapon
 * slot and the shield slot never spoke to each other.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, savedPlayer } from './helpers.mjs';
import { getItemTemplate } from '../public/js/base.js';
import { deepItem } from '../public/js/dice.js';
import { itemDescription } from '../public/js/describe.js';
import { validateItem } from '../lib/expansion.js';
import { PACK_LIMIT } from '../public/js/engine.js';

function rig(seed = 'h') {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  return { g, p: g.state.player };
}

const sword2h = () => deepItem(getItemTemplate('two-handed-sword'));
const shield = (id = 'tower-shield') => deepItem(getItemTemplate(id));

test('taking up a two-handed sword slings the shield to your pack', () => {
  const { g, p } = rig('h-sword');
  p.equipment.shield = shield();
  const it = sword2h();
  p.inventory.push(it);
  g.logs.length = 0;
  g.equip(it);
  assert.equal(p.equipment.weapon, it);
  assert.equal(p.equipment.shield, null, 'the shield stayed on the arm');
  assert.ok(p.inventory.some((x) => x && x.id === 'tower-shield'), 'the shield vanished instead of going to the pack');
  assert.match(g.logs.join(' '), /both hands/i);
});

test('taking up a shield slings the two-handed sword', () => {
  const { g, p } = rig('h-shield');
  p.equipment.weapon = sword2h();
  const sh = shield('small-shield');
  p.inventory.push(sh);
  g.equip(sh);
  assert.equal(p.equipment.shield, sh);
  assert.equal(p.equipment.weapon, null);
  assert.ok(p.inventory.some((x) => x && x.id === 'two-handed-sword'));
});

test('a full pack refuses the trade instead of eating the shield', () => {
  const { g, p } = rig('h-full');
  p.equipment.shield = shield();
  const it = sword2h();
  p.inventory.push(it);
  while (p.inventory.length < PACK_LIMIT) p.inventory.push(deepItem(getItemTemplate('potion-heal')));
  g.equip(it);
  assert.notEqual(p.equipment.weapon && p.equipment.weapon.id, 'two-handed-sword', 'it equipped anyway');
  assert.ok(p.equipment.shield, 'the shield was lost');
});

test('a cursed shield keeps both hands from the sword — and names itself', () => {
  const { g, p } = rig('h-cursed');
  const sh = shield();
  sh.cursed = true;
  sh.identified = false;
  sh.trueName = '-1 Tower Shield (accursed)';
  p.equipment.shield = sh;
  const it = sword2h();
  p.inventory.push(it);
  g.equip(it);
  assert.ok(!p.equipment.weapon || p.equipment.weapon.id !== 'two-handed-sword');
  assert.match(sh.name, /accursed/, 'the failed trade taught you nothing');
});

test('an old save carrying both comes back holding one', () => {
  const { g } = rig('h-old');
  const saved = JSON.parse(JSON.stringify(g.save()));
  const who = savedPlayer(saved);
  who.equipment.weapon = deepItem(getItemTemplate('two-handed-sword'));
  delete who.equipment.weapon.twoHanded;   /* items predate the rule */
  who.equipment.shield = deepItem(getItemTemplate('tower-shield'));

  const back = newGame('h-old-2');
  back.restore(saved);
  const p2 = back.state.player;
  assert.equal(p2.equipment.weapon.twoHanded, true, 'the rule was not re-stamped onto the old item');
  assert.equal(p2.equipment.shield, null, 'the save came back holding both');
  assert.ok(p2.inventory.some((x) => x && x.id === 'tower-shield'), 'the shield was dropped rather than stowed');
});

test('the card says it needs both hands', () => {
  assert.match(itemDescription(getItemTemplate('two-handed-sword')), /both hands/i);
});

test('the Library may write a two-handed weapon, and only a weapon', () => {
  const axe = validateItem({ name: 'Hewing Axe', kind: 'weapon', twoHanded: true, effects: { damage: { dice: 2, sides: 6 } } });
  assert.equal(axe.twoHanded, true);
  const sh = validateItem({ name: 'Broad Wall', kind: 'shield', twoHanded: true, effects: { acBonus: 2 } });
  assert.equal(sh.twoHanded, undefined, 'a two-handed SHIELD leaked through');
});

test('an old copy asleep in a floor memory cannot dodge the rule', () => {
  /* Items dropped on floors live in the save as snapshots; the stamp-on-load
   * migration never saw them. The rule now asks the TEMPLATE at the moment of
   * equipping, so no copy is old enough to slip past. */
  const { g, p } = (() => { const g = newGame('h-memo', 'fighter'); g.loadFloor(0); g.currentFloor.monsters.length = 0; return { g, p: g.state.player }; })();
  p.equipment.shield = deepItem(getItemTemplate('tower-shield'));
  const old = deepItem(getItemTemplate('two-handed-sword'));
  delete old.twoHanded;
  p.inventory.push(old);
  g.equip(old);
  assert.ok(!(p.equipment.weapon && p.equipment.shield), 'both ended up equipped');
  assert.equal(p.equipment.weapon, old);
  assert.ok(p.inventory.some((x) => x && x.id === 'tower-shield'));
});
