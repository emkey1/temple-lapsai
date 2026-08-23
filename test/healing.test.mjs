/* Healing.
 *
 * The report was that potions "do not work — in fact they seem to hurt". They
 * worked; the turn they cost was worth more than the dice they rolled, and the
 * dice never grew while everything around them did. These tests pin the shape
 * of the fix: a burst heal mends at least a share of your maximum health, the
 * share is never a nerf, and what the gear panel promises is what the engine
 * actually does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import {
  getItemTemplate, ABILITIES, HEAL_FLOORS,
  healFractionForItem, healFractionForAbility, healthShare,
} from '../public/js/base.js';
import { itemDescription, abilityHealNote } from '../public/js/describe.js';
import { deepItem, evaluateDice } from '../public/js/dice.js';
import { validateEffects, validateAbility, validateItem } from '../lib/expansion.js';

/* A character grown the way the game grows one. */
function heroAt(level, cls = 'fighter', seed = 'heal') {
  const g = newGame(`${seed}-${cls}-${level}`, cls);
  for (let i = 1; i < level; i++) g.levelUp();
  return { g, p: g.state.player };
}

/* What the heal itself mended, read back off the log.
 *
 * Watching p.hp across the call would fold in the turn that useItem spends:
 * out-of-combat regeneration ticks on the way past and quietly adds a point or
 * two, which is exactly the sort of thing that makes a balance test lie. */
function mendedByLast(g) {
  for (let i = g.logs.length - 1; i >= 0; i--) {
    const m = String(g.logs[i]).match(/Sweet relief: \+(\d+) HP|wand warms: \+(\d+) HP|knit your wounds for (\d+) hit points/);
    if (m) return Number(m[1] || m[2] || m[3]);
  }
  return 0;
}

const drink = (g, p, id) => {
  const it = deepItem(getItemTemplate(id));
  p.inventory.push(it);
  g.useItem(it);
  return mendedByLast(g);
};

/* ---- the floor never takes anything away ---- */

test('a level 1 character heals exactly as much as they always did', () => {
  for (const cls of ['fighter', 'thief', 'mage', 'cleric']) {
    const { g, p } = heroAt(1, cls);
    const worst = 4;    /* 2d4+2 cannot roll below 4 */
    for (let i = 0; i < 60; i++) {
      p.hp = 1;
      const mended = drink(g, p, 'potion-heal');
      assert.ok(mended >= worst, `${cls}: a potion mended ${mended}`);
      assert.ok(mended <= 10, `${cls}: mended ${mended} — the floor is doing work at level 1, where it should be idle`);
    }
  }
});

test('the floor only ever raises the number, never lowers it', () => {
  /* The property that makes this safe to ship: max(roll, floor) >= roll. */
  for (const level of [1, 2, 4, 8, 12]) {
    const { g, p } = heroAt(level);
    for (let i = 0; i < 40; i++) {
      p.hp = 1;
      assert.ok(drink(g, p, 'potion-heal') >= 4, `level ${level} healed less than the dice allow`);
    }
  }
});

/* ---- and at depth it does the thing it was written for ---- */

test('a potion is worth a share of a big character, not a rounding error', () => {
  const { g, p } = heroAt(8);
  assert.ok(p.maxhp >= 40, `level 8 fighter has only ${p.maxhp} max HP; the rig is wrong`);
  p.hp = 1;
  const mended = drink(g, p, 'potion-heal');
  assert.equal(mended, Math.round(p.maxhp * HEAL_FLOORS.draught));
  assert.ok(mended > 12, `a potion mended ${mended} of a ${p.maxhp} HP bar`);
});

test('the strong draught is the strong one at every size', () => {
  for (const level of [4, 8, 12]) {
    const { g, p } = heroAt(level);
    p.hp = 1; const small = drink(g, p, 'potion-heal');
    p.hp = 1; const large = drink(g, p, 'potion-major-heal');
    assert.ok(large > small, `level ${level}: Superior mended ${large}, common mended ${small}`);
  }
});

test('every kind of burst heal scales, not just the one that was reported', () => {
  const { g, p } = heroAt(10, 'cleric');
  const at = (fn) => { p.hp = 1; fn(); return mendedByLast(g); };
  const potion = at(() => drink(g, p, 'potion-heal'));
  const wand = at(() => { const w = deepItem(getItemTemplate('wand-of-healing')); p.inventory.push(w); g.useItem(w); });
  const ability = at(() => { p.power = p.maxpower; g.activateAbility('lay-hands'); });
  for (const [name, v] of [['potion', potion], ['wand charge', wand], ['Lay on Hands', ability]]) {
    assert.ok(v >= Math.round(p.maxhp * 0.15), `${name} mended ${v} of ${p.maxhp} — it never got the floor`);
  }
  assert.ok(ability > potion, 'the Cleric signature is no better than a bottle off the floor');
});

/* ---- the turn is the thing being spent, so do not spend it for nothing ---- */

test('drinking at full health costs neither the flask nor the turn', () => {
  const { g, p } = heroAt(6);
  p.hp = p.maxhp;
  const it = deepItem(getItemTemplate('potion-heal'));
  p.inventory.push(it);
  const turn = g.turn;
  g.useItem(it);
  assert.equal(p.inventory.includes(it), true, 'the flask was drunk for nothing');
  assert.equal(g.turn, turn, 'the turn was spent for nothing');
});

test('the log reports what was mended, not what was rolled', () => {
  const { g, p } = heroAt(8);
  p.hp = p.maxhp - 2;
  drink(g, p, 'potion-major-heal');
  const line = g.logs.filter((l) => /Sweet relief/.test(l)).pop();
  assert.ok(line, 'no healing was logged at all');
  assert.match(line, /\+2 HP/, `the log said "${line}" while mending 2`);
});

/* ---- what the panel promises is what the engine does ---- */

test('the gear panel prints the number the engine will actually mend', () => {
  for (const level of [1, 4, 8, 12]) {
    const { g, p } = heroAt(level);
    for (const id of ['potion-heal', 'potion-major-heal']) {
      const promised = itemDescription(getItemTemplate(id), { maxhp: p.maxhp });
      const fixed = promised.match(/^mends (\d+) hp —/);
      if (!fixed) continue;   /* the dice can still beat the floor at this size */
      p.hp = 1;
      const mended = drink(g, p, id);
      assert.equal(mended, Number(fixed[1]),
        `level ${level} ${id}: the card promised ${fixed[1]} and the engine mended ${mended}`);
    }
  }
});

test('a healing power says what it will do, including one the Library wrote', () => {
  for (const a of ABILITIES.filter((x) => x.kind === 'heal')) {
    const note = abilityHealNote(a, { maxhp: 60 });
    assert.ok(note, `${a.name} promises nothing`);
    assert.ok(note.includes(healthShare(healFractionForAbility(a))), `${a.name} names the wrong share`);
  }
  const written = validateAbility({ name: 'Balm', cls: 'cleric', level: 4, kind: 'heal', powerCost: 4, heal: { dice: 2, sides: 6 } });
  assert.ok(abilityHealNote(written, { maxhp: 60 }), 'a written power hides its floor');
});

test('a power that costs nothing and waits for nothing gets no floor at all', () => {
  /* validateAbility defaults powerCost and cooldown to 0, so the Library can
   * mint one. With a floor it would be an unlosable button. */
  const free = validateAbility({ name: 'Free Balm', cls: 'cleric', level: 9, kind: 'heal', heal: { dice: 2, sides: 6 } });
  assert.equal(free.powerCost, 0);
  assert.equal(free.cooldown, 0);
  assert.equal(healFractionForAbility(free), 0);
  assert.equal(abilityHealNote(free, { maxhp: 200 }), '');

  const paid = { ...free, powerCost: 4 };
  assert.ok(healFractionForAbility(paid) > 0, 'a power that costs something should scale');
});

/* ---- what the Library writes ---- */

test('a written potion heals what it was written to heal', () => {
  /* clampInt runs Number(v), Number('2d4+2') is NaN, and NaN took the default:
   * every healing potion the oracle ever wrote was a 1 HP potion. */
  assert.equal(validateEffects({ heal: { dice: 4, sides: 6, bonus: 4 } }).heal, '4d6+4');
  assert.equal(validateEffects({ heal: '2d4+2' }).heal, '2d4+2');
  assert.equal(validateEffects({ heal: 12 }).heal, 12);
  assert.equal(validateEffects({ heal: 999 }).heal, 100);
  assert.equal(validateEffects({ heal: 0 }).heal, 1);
  for (const shape of [{ dice: 4, sides: 6, bonus: 4 }, '2d4+2', 12]) {
    const v = evaluateDice(validateEffects({ heal: shape }).heal);
    assert.ok(v >= 4, `a potion written as ${JSON.stringify(shape)} heals ${v}`);
  }
});

test('a written potion is floored gently, whatever tier the oracle called it', () => {
  /* The prompt tells the oracle tier runs 0-15 while the shipped items run
   * 0-5, so a generated floor-one draught is tier 3 — the same number the
   * Superior carries. Nothing may read tier to decide the share. */
  for (const tier of [0, 1, 3, 8, 15]) {
    const it = validateItem({ name: 'Draught', kind: 'potion', tier, effects: { heal: 6 } });
    assert.equal(healFractionForItem({ ...it, id: 'exp-1' }), HEAL_FLOORS.draught,
      `a tier ${tier} written potion got the strong fraction`);
  }
  assert.equal(healFractionForItem(getItemTemplate('potion-major-heal')), HEAL_FLOORS.greatDraught);
});

test('a written healing wand is not thirty charges of a fifth of you', () => {
  assert.equal(validateEffects({ spell: 'heal', charges: 30 }).charges, 12);
  assert.equal(validateEffects({ spell: 'firebolt', charges: 30 }).charges, 30, 'the cap leaked onto every wand');
});

/* ---- the stairs ---- */

test('the breath at the stairs is paid for going down, not for going anywhere', () => {
  const { g, p } = heroAt(6);
  p.dungeonId = 'temple';
  g.loadFloor(0);

  p.hp = 5;
  g.loadFloor(1);
  const afterDescent = p.hp;
  assert.ok(afterDescent > 5, 'descending no longer costs a breath, it should');

  p.hp = 5;
  g.loadFloor(0);
  assert.equal(p.hp, 5, 'climbing back up healed you');

  p.hp = 5;
  g.loadFloor(0);
  assert.equal(p.hp, 5, 'reloading the same floor healed you');
});

test('walking up and down the stairs is not a healing potion', () => {
  /* 15% of max per loadFloor, and loadFloor is how you ascend, how the camp
   * button puts you back and how a save is loaded. "Am I going down" is not
   * enough of a test either: down, up, down is still down twice. */
  const { g, p } = heroAt(10);
  p.dungeonId = 'temple';
  g.loadFloor(0);
  g.loadFloor(1);
  p.hp = 4;
  for (let i = 0; i < 8; i++) { g.loadFloor(0); g.loadFloor(1); }
  assert.equal(p.hp, 4, `sixteen flights of stairs mended ${p.hp - 4} of a ${p.maxhp} HP bar`);
});

test('but the first trip to a new depth still buys you a breath', () => {
  const { g, p } = heroAt(10);
  p.dungeonId = 'temple';
  g.loadFloor(0);
  p.hp = 4;
  g.loadFloor(1);
  assert.ok(p.hp > 4, 'arriving somewhere new at four hit points is an automatic death');
});
