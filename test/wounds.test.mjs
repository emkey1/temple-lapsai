/* THE RESTED LINE.
 *
 * Reported: "Altars are now largely pointless due to super fast healing."
 * Measured, the cause was not the speed. Out-of-combat regeneration is
 * oversubscribed three to twelve times — the engine offers far more free
 * mending than a player has room to absorb — and the walk to a floor's single
 * altar is 31 turns, which at a hit point a turn is worth more than the altar
 * gives. The bot touched an altar on 18-29% of floors, arrived at 68-83% of
 * maximum health, and 20-63% of firings landed on a full bar. Turning the
 * supply down cannot fix a supply nobody can use up.
 *
 * A CEILING is the one thing a walk cannot raise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { RECOVERY, getItemTemplate } from '../public/js/base.js';
import { deepItem } from '../public/js/dice.js';

function hero(seed = 'w', cls = 'fighter', level = 6) {
  const g = newGame(seed, cls);
  for (let i = 1; i < level; i++) g.levelUp();
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;   /* out of combat, so resting works */
  return { g, p: g.state.player };
}

test('a fresh character has no wounds and can rest to the top', () => {
  const { g, p } = hero('w-fresh');
  assert.equal(p.wounds, 0);
  assert.equal(g.restedCap(p), p.maxhp);
});

test('fifteen scratches and one mauling leave the same wound', () => {
  /* Carried as a fraction. Rounding each blow up would make a flurry worse
   * than a maul, and on a 22 point bar it would be lethal — the same mistake
   * as clamping the regeneration fraction up to a whole point. */
  const a = hero('w-scratch');
  for (let i = 0; i < 15; i++) a.g.takeWound(2, a.p);
  const b = hero('w-maul');
  b.g.takeWound(30, b.p);
  assert.equal(a.p.wounds, b.p.wounds, `${a.p.wounds} from scratches, ${b.p.wounds} from one blow`);
  assert.equal(a.p.wounds, Math.floor(30 * RECOVERY.woundShare));
});

test('resting ends at the line, in one press, and says so', () => {
  const { g, p } = hero('w-rest');
  p.hp = 1;
  g.takeWound(40, p);
  const cap = g.restedCap(p);
  assert.ok(cap < p.maxhp, 'nothing was wounded');
  g.logs.length = 0;
  g.rest(400);
  assert.equal(p.hp, cap, `rested to ${p.hp}, the line is ${cap}`);
  assert.match(g.logs.join(' '), /beyond your reach/, 'it stopped short without saying why');
});

test('the trickle and a Ring of Regeneration both stop there too', () => {
  const { g, p } = hero('w-tick');
  p.equipment.ring = { name: 'Ring', kind: 'ring', slot: 'ring', effects: { regen: 3 } };
  p.hp = 1;
  g.takeWound(40, p);
  const cap = g.restedCap(p);
  for (let i = 0; i < 400; i++) g.endPlayerTurn();
  assert.equal(p.hp, cap, `free mending reached ${p.hp} against a line of ${cap}`);
});

test('however badly used, most of the bar is always yours to rest back to', () => {
  const { g, p } = hero('w-floor');
  for (let i = 0; i < 400; i++) g.takeWound(10, p);
  assert.ok(g.restedCap(p) >= Math.ceil(p.maxhp * RECOVERY.woundFloor),
    `four thousand points of punishment left the line at ${g.restedCap(p)} of ${p.maxhp}`);
});

test('a draught reaches past the line, and closes a little of it', () => {
  /* Which is what makes one worth carrying once sitting down has a limit. */
  const { g, p } = hero('w-draught');
  g.takeWound(60, p);
  const cap = g.restedCap(p);
  p.hp = cap;
  const before = p.wounds;
  const it = deepItem(getItemTemplate('potion-major-heal'));
  p.inventory.push(it);
  g.useItem(it);
  assert.ok(p.hp > cap, `the draught stopped at the line: ${p.hp} of ${p.maxhp}`);
  assert.ok(p.wounds < before, `it mended nothing of the wound (${before} -> ${p.wounds})`);
});

test('nothing free ever drags a character back down to the line', () => {
  const { g, p } = hero('w-nodrag');
  g.takeWound(60, p);
  p.hp = p.maxhp;                       /* drank past it */
  for (let i = 0; i < 20; i++) g.endPlayerTurn();
  assert.equal(p.hp, p.maxhp, 'a turn of regeneration pulled the player down to the line');
});

test('an altar closes all of it, which is the only free thing that does', () => {
  const { g, p } = hero('w-altar');
  g.takeWound(60, p);
  p.hp = g.restedCap(p);
  const wounded = p.wounds;
  assert.ok(wounded > 0);
  const spot = g.currentFloor.altar || { x: p.x, y: p.y };
  g.logs.length = 0;
  g.useAltar(spot.x, spot.y);
  assert.equal(p.wounds, 0, `the altar left ${p.wounds} of ${wounded} unclosed`);
  assert.match(g.logs.join(' '), /would not close, closes/);
  assert.equal(g.restedCap(p), p.maxhp);
});

test('an altar answers a character who is full but wounded', () => {
  /* It used to refuse anyone at full health, which after a 31-turn walk was
   * most of them: measured, 20-63% of firings landed on a full bar. */
  const { g, p } = hero('w-altar-full');
  g.takeWound(60, p);
  p.hp = p.maxhp;
  p.power = p.maxpower;
  const spot = g.currentFloor.altar || { x: p.x, y: p.y };
  g.logs.length = 0;
  g.useAltar(spot.x, spot.y);
  assert.equal(p.wounds, 0, 'the altar refused a wounded character for being full');
  assert.ok(!/nothing to ask it for/.test(g.logs.join(' ')));
});

test('and still refuses someone who genuinely needs nothing', () => {
  const { g, p } = hero('w-altar-none');
  p.hp = p.maxhp;
  p.power = p.maxpower;
  p.wounds = 0;
  const spot = g.currentFloor.altar || { x: p.x, y: p.y };
  g.logs.length = 0;
  g.useAltar(spot.x, spot.y);
  assert.match(g.logs.join(' '), /nothing to ask it for/);
});

test('one altar serves each member of a party once', () => {
  const { g, p } = hero('w-altar-party');
  g.takeWound(60, p);
  const spot = g.currentFloor.altar || { x: p.x, y: p.y };
  g.useAltar(spot.x, spot.y);
  assert.equal(p.wounds, 0);

  /* A second member steps up to the same stone. */
  const second = { ...JSON.parse(JSON.stringify(p)), name: 'Second' };
  g.state.party.members.push(second);
  g.state.party.active = 1;
  g.takeWound(60, g.state.player);
  g.logs.length = 0;
  g.useAltar(spot.x, spot.y);
  assert.equal(g.state.player.wounds, 0, 'the altar was cold for the second member');

  /* But not the same one twice. */
  g.state.party.active = 0;
  g.takeWound(60, g.state.player);
  g.logs.length = 0;
  g.useAltar(spot.x, spot.y);
  assert.match(g.logs.join(' '), /cold/, 'the same character drank twice from one altar');
});

test('the stairs mend the ceiling, which gives them something to do again', () => {
  /* Measured before this: the breath fired 61 times and delivered zero hit
   * points every time, because the player was always full on arrival. */
  const { g, p } = hero('w-stairs');
  p.dungeonId = 'temple';
  g.takeWound(60, p);
  const before = p.wounds;
  g.loadFloor(1);
  assert.ok(p.wounds < before, `the breath mended nothing (${before} -> ${p.wounds})`);
});

test('camp is the one bed in the world', () => {
  const { g, p } = hero('w-camp');
  g.takeWound(60, p);
  assert.ok(p.wounds > 0);
  g.returnToCamp(false);
  assert.equal(g.state.player.wounds, 0, 'wounds followed the player out of the dark');
});

test('a save written before wounds existed comes back unwounded', () => {
  const { g } = hero('w-legacy');
  const saved = JSON.parse(JSON.stringify(g.save()));
  delete saved.party.members[0].wounds;
  const back = newGame('w-legacy-2');
  back.restore(saved);
  assert.equal(back.state.player.wounds, 0);
  assert.equal(back.restedCap(back.state.player), back.state.player.maxhp);
});

test('the oracle cannot write a wound or mend one', () => {
  const hostile = { heal: 9999, wounds: -50, woundMend: 99, regen: 99 };
  assert.equal(hostile.wounds, -50);   /* it may ask */
  return import('../lib/expansion.js').then(({ validateEffects }) => {
    const out = validateEffects(hostile);
    assert.equal(out.wounds, undefined, 'a written item can set wounds');
    assert.equal(out.woundMend, undefined, 'a written item can mend wounds directly');
    assert.ok(out.regen <= 5, 'a written ring regenerates without bound');
  });
});
