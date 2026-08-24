/* CURSES THAT ARE ACTUALLY TRAPS.
 *
 * A cursed item used to be a +2 sword you could not put down: the same bonuses
 * as a blessing, one inconvenience, and its name shown in red the moment it
 * hit the pack. Reported: "cursed items need to have some sort of down side in
 * addition to not being removable. Also, they should not be easily identified
 * as cursed."
 *
 * Now a curse is an enchantment lying about its sign — the same blue gleam and
 * the same unread rune as a blessing, with the bonuses run the other way. You
 * find out by wearing it, by failing to take it off, or by reading it first,
 * which is what the Scroll of Identify is for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { getItemTemplate } from '../public/js/base.js';
import { deepItem, applyMagic, applyCurse } from '../public/js/dice.js';
import { itemDescription } from '../public/js/describe.js';
import { validateItem } from '../lib/expansion.js';
import { RNG } from '../public/js/rng.js';

function rig(seed = 'c', cls = 'fighter') {
  const g = newGame(seed, cls);
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  return { g, p: g.state.player };
}

const cursedSword = (level = 2) => applyCurse(deepItem(getItemTemplate('broadsword')), level);

/* ---- the disguise ---- */

test('a fresh curse is indistinguishable from a blessing', () => {
  const trap = cursedSword();
  const prize = applyMagic(deepItem(getItemTemplate('broadsword')), 2);
  assert.equal(trap.name, prize.name, 'the names differ before reading');
  assert.equal(trap.color, prize.color, 'the colours differ before reading');
  assert.equal(trap.identified, false);
  assert.doesNotMatch(itemDescription(trap), /curse|accursed/i);
  assert.doesNotMatch(itemDescription(trap), /-2/, 'the penalty leaked through the rules text');
});

test('but its enchantment runs the other way, and it applies while worn', () => {
  const { g, p } = rig('c-neg');
  const base = g.derived();
  p.equipment.weapon = cursedSword(2);
  const worn = g.derived();
  assert.ok(worn.toHit < base.toHit, `to-hit went ${base.toHit} -> ${worn.toHit}`);
  assert.ok(worn.dmg.bonus < base.dmg.bonus, 'the damage penalty never landed');
});

/* ---- the three ways it comes out ---- */

test('trying to take it off reveals it, and it stays on', () => {
  const { g, p } = rig('c-stuck');
  p.equipment.weapon = cursedSword(2);
  g.logs.length = 0;
  g.unequip('weapon');
  assert.equal(p.equipment.weapon.cursed, true);
  assert.ok(p.equipment.weapon, 'the curse let go');
  assert.equal(p.equipment.weapon.identified, true, 'failing to remove it taught you nothing');
  assert.match(p.equipment.weapon.name, /accursed/, 'the true name never swapped in');
  assert.match(g.logs.join(' '), /cursed/i);
});

test('and so does trying to swap something else into its hand', () => {
  /* unequip refused to remove a curse, but equip would happily swap one out —
   * "will not come off" was a door with no wall around it. */
  const { g, p } = rig('c-swap');
  p.equipment.weapon = cursedSword(2);
  const mace = deepItem(getItemTemplate('mace'));
  p.inventory.push(mace);
  g.equip(mace);
  assert.match(p.equipment.weapon.name, /accursed/, 'the swap went through a curse');
  assert.ok(p.inventory.includes(mace), 'the mace vanished');
});

test('a Scroll of Identify names everything, curse and all', () => {
  const { g, p } = rig('c-scroll');
  const trap = cursedSword(2);
  const prize = applyMagic(deepItem(getItemTemplate('leather-armor')), 1);
  p.inventory.push(trap, prize);
  g.logs.length = 0;
  g.identifyAll();
  assert.equal(trap.identified, true);
  assert.match(trap.name, /accursed/);
  assert.match(prize.name, /\+1/);
  assert.match(g.logs.join(' '), /wishes you ill/, 'the scroll read a curse and said nothing');
});

test('lifting a curse names it and lets it go', () => {
  const { g, p } = rig('c-lift');
  p.equipment.weapon = cursedSword(2);
  g.removeAllCurses();
  assert.equal(p.equipment.weapon.cursed, false);
  assert.match(p.equipment.weapon.name, /accursed/, 'you never learned what had you');
  g.unequip('weapon');
  assert.equal(p.equipment.weapon, null, 'uncursed, it still would not come off');
});

/* ---- supply ---- */

test('the Scroll of Identify actually drops now', () => {
  /* It existed in the data and was in NO pool — it had never once dropped,
   * the same bug shape as the game shipping exactly one healing item. */
  const g = newGame('c-drops');
  g.state.player.dungeonId = 'upper';
  let found = 0;
  for (let s = 0; s < 400; s++) {
    const it = g.pickItem(1, new RNG(`ident-${s}`));
    if (it && it.id === 'scroll-identify') found++;
  }
  assert.ok(found > 0, 'four hundred draws and no Scroll of Identify');
});

test('a share of enchanted finds are traps, and every trap is net-negative', () => {
  const g = newGame('c-share');
  g.state.player.dungeonId = 'upper';
  let enchanted = 0, cursed = 0;
  for (let s = 0; s < 600; s++) {
    const it = g.pickItem(2, new RNG(`share-${s}`));
    if (!it || !it.magicLevel) continue;
    enchanted++;
    if (!it.cursed) continue;
    cursed++;
    const fx = it.effects || {};
    const net = (fx.toHit || 0) + ((fx.damage && fx.damage.bonus) || 0) + (fx.acBonus || 0);
    assert.ok(net < 0, `${it.trueName || it.name} is cursed and still a net gain (${net})`);
    if ('acBonus' in fx) assert.ok(fx.acBonus <= -1, `${it.trueName}: cursed armour still armours (${fx.acBonus})`);
    if (it.kind === 'weapon') assert.ok(fx.toHit <= -1, `${it.trueName}: a cursed weapon still aims true`);
    assert.equal(it.identified, false, 'a fresh curse arrived pre-announced');
  }
  assert.ok(enchanted > 30, `only ${enchanted} enchanted items in six hundred draws`);
  assert.ok(cursed > 0, 'no curse in six hundred draws');
  assert.ok(cursed / enchanted < 0.35, `${cursed} of ${enchanted} enchanted finds are cursed — too many to ever equip anything`);
});

/* ---- the oracle ---- */

test('a curse the Library writes arrives unread too', () => {
  const written = validateItem({ name: 'Gleaming Band', kind: 'ring', cursed: true, effects: { acBonus: -2 } });
  assert.equal(written.cursed, true);
  assert.equal(written.identified, false, 'a written curse shows in red the moment it lands');
  const honest = validateItem({ name: 'Plain Band', kind: 'ring', effects: { acBonus: 1 } });
  assert.equal(honest.identified, true, 'an honest written item made the player read it for nothing');
});

/* ---- old saves ---- */

test('a curse from before the rework still works, just visibly', () => {
  /* Old saves carry cursed items with positive effects and identified: true.
   * They keep their bonuses — retroactively punishing a prize already won would
   * be unfair — and they still refuse to come off. */
  const { g, p } = rig('c-old');
  const old = deepItem(getItemTemplate('broadsword'));
  old.cursed = true;
  p.equipment.weapon = old;
  g.unequip('weapon');
  assert.ok(p.equipment.weapon, 'an old-style curse let go');
});

test('an item enchanted under the old scheme loads already read', () => {
  /* Old applyMagic baked "+3 ..." into the name AND set identified false. The
   * new unread card would show base stats and a rune under a name that has
   * already spilled everything — so on load, anything named but unread with no
   * hidden true name is simply marked read. */
  const g = newGame('c-oldmagic');
  const saved = JSON.parse(JSON.stringify(g.save()));
  const who = saved.party.members[0];
  const old = deepItem(getItemTemplate('plate'));
  old.name = '+4 Plate Armor';
  old.magicLevel = 4;
  old.effects.acBonus = 10;
  old.identified = false;          /* the old scheme: renamed, yet "unread" */
  who.equipment.body = old;

  const back = newGame('c-oldmagic-2');
  back.restore(saved);
  const worn = back.state.player.equipment.body;
  assert.equal(worn.identified, true, 'the card still claims an unread rune under a telltale name');
  assert.match(itemDescription(worn), /\+10 armour/, 'the card shows base stats instead of the truth');
});
