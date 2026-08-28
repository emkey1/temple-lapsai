/* THE PARTY CONTAINER.
 *
 * state.player stops being a field and becomes the character whose turn it is
 * — an accessor onto the party. That keeps the ninety-odd places in the engine
 * and seventeen in the UI that read it working unchanged while there stops
 * being exactly one of them.
 *
 * The design review that sent us here was blunt about why this comes first:
 * initiative orders actors, and in a game with one actor the order between the
 * player and everything else is not perceivable — measured, no monster ever
 * acted before the player, not once in 9,614 swings. Ordering only means
 * something once there is more than one of you.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, savedPlayer, legacyShape } from './helpers.mjs';
import { installParty, adoptParty, makePlayer, initialStats, assignTints } from '../public/js/engine.js';

test('a new game has a party of one, and state.player is its member', () => {
  const g = newGame('party-one');
  assert.equal(g.state.party.members.length, 1);
  assert.equal(g.state.party.active, 0);
  assert.equal(g.state.player, g.state.party.members[0]);
  assert.ok(g.state.player.name);
});

test('state.player follows whoever is active', () => {
  const g = newGame('party-active');
  const second = makePlayer('Second', 'mage', initialStats('mage'));
  g.state.party.members.push(second);
  assert.equal(g.state.player.name, 'Tester');
  g.state.party.active = 1;
  assert.equal(g.state.player, second);
  assert.equal(g.state.player.name, 'Second');
});

test('assigning state.player fills the active slot rather than shadowing it', () => {
  /* foundAdventurer does exactly this, and it has to keep working. */
  const g = newGame('party-assign');
  const replacement = makePlayer('Replacement', 'cleric', initialStats('cleric'));
  g.state.player = replacement;
  assert.equal(g.state.party.members.length, 1, 'assigning grew the party');
  assert.equal(g.state.party.members[0], replacement);
  assert.equal(g.state.player, replacement);
});

test('the accessor does not survive into the save as a second copy', () => {
  /* save() is a JSON round trip. A `player` that serialised alongside the
   * party would come back as a second, divergent copy of one character — the
   * belt bug one level up. */
  const g = newGame('party-save');
  const saved = g.save();
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'player'), false,
    'the save carries a duplicate of the active member');
  assert.ok(saved.party, 'the save carries no party');
  assert.equal(saved.party.members.length, 1);
  assert.equal(JSON.stringify(saved).includes('"player"'), false);
});

test('a save round-trips and the accessor comes back live', () => {
  const g = newGame('party-round');
  g.state.player.gold = 4321;
  const saved = JSON.parse(JSON.stringify(g.save()));
  const back = newGame('party-round-2');
  back.restore(saved);
  assert.equal(back.state.player.gold, 4321);
  back.state.player.gold = 9;
  assert.equal(back.state.party.members[0].gold, 9, 'the accessor came back detached from the party');
});

test('a save written before the party existed becomes a party of one', () => {
  const g = newGame('party-legacy');
  g.state.player.name = 'Old Hand';
  g.state.player.gold = 77;
  const old = legacyShape(g.save());
  assert.ok(old.player, 'the rig did not build a legacy save');
  assert.equal(old.party, undefined);

  const back = newGame('party-legacy-2');
  back.restore(old);
  assert.equal(back.state.party.members.length, 1);
  assert.equal(back.state.player.name, 'Old Hand');
  assert.equal(back.state.player.gold, 77);
  /* `player` is an own property either way — the question is whether it is
   * still a DATA field holding a stale second copy, or the accessor. */
  const d = Object.getOwnPropertyDescriptor(back.state, 'player');
  assert.ok(d && typeof d.get === 'function', 'player is not an accessor');
  assert.equal('value' in d, false, 'the legacy field was left behind next to the party');
  assert.equal(d.enumerable, false, 'the accessor would serialise into the next save');
});

test('a legacy save then saves in the new shape', () => {
  const g = newGame('party-relegacy');
  const back = newGame('party-relegacy-2');
  back.restore(legacyShape(g.save()));
  const again = back.save();
  assert.ok(again.party);
  assert.equal(Object.prototype.hasOwnProperty.call(again, 'player'), false,
    'the re-save carries a duplicate character');
});

test('an active index pointing at nobody falls back rather than crashing', () => {
  const state = adoptParty({ party: { members: [], active: 4 } });
  assert.equal(state.party.active, 0);
  assert.equal(state.player, null);

  const one = adoptParty({ party: { members: [{ name: 'A' }], active: 9 } });
  assert.equal(one.player.name, 'A');
});

test('rubbish where a party should be does not take the game down', () => {
  for (const junk of [{}, { party: null }, { party: 'no' }, { party: { members: 'no' } }]) {
    const state = adoptParty({ ...junk });
    assert.ok(Array.isArray(state.party.members));
    assert.equal(state.player, null);
  }
});

test('installing twice does not double anything', () => {
  const g = newGame('party-twice');
  installParty(g.state);
  installParty(g.state);
  assert.equal(g.state.party.members.length, 1);
  assert.equal(g.state.player, g.state.party.members[0]);
});

test('the saved shape is what the ledger reads', () => {
  /* The ledger summarises a save it has never restored, so it has to know
   * where the character lives inside one. */
  const g = newGame('party-ledger');
  g.state.player.name = 'Marlyle';
  const saved = JSON.parse(JSON.stringify(g.save()));
  assert.equal(savedPlayer(saved).name, 'Marlyle');
  assert.equal(savedPlayer(legacyShape(saved)).name, 'Marlyle');
});

/* ---- the order of the company ----
 *
 * The roster decides who stands where when the party lands on a floor and
 * who inherits the reins when the holder falls, so the player gets to say
 * what it is — by dragging a nameplate. `active` follows the MEMBER
 * through the shuffle, never the slot. */
test('reordering the company keeps the reins with the same character', () => {
  const g = newGame('order-reins');
  const names = ['Ash', 'Bru', 'Cad'];
  for (const n of names) {
    const m = makePlayer(n, 'fighter', initialStats('fighter'));
    g.state.party.members.push(m);
  }
  const roster = () => g.state.party.members.map((m) => m.name);
  const before = roster();
  g.state.party.active = 2;                     /* whoever that is holds the reins */
  const held = g.state.player;
  assert.ok(g.reorderParty(3, 0), 'the move was refused');
  assert.equal(g.state.player, held, 'the reins changed hands during a reshuffle');
  assert.notDeepEqual(roster(), before, 'nothing moved');
  assert.equal(roster()[0], before[3], 'the dragged member did not land where it was dropped');
});

test('a reorder that goes nowhere changes nothing', () => {
  const g = newGame('order-noop');
  g.state.party.members.push(makePlayer('Ash', 'thief', initialStats('thief')));
  const before = g.state.party.members.map((m) => m.name);
  assert.equal(g.reorderParty(1, 1), false);
  assert.equal(g.reorderParty(0, 9), false, 'a drop past the end was accepted');
  assert.deepEqual(g.state.party.members.map((m) => m.name), before);
});

test('a member keeps their colour when the line is redrawn', () => {
  /* The tint used to come from the roster index, so dragging a nameplate
   * repainted half the company — and the one question colour exists to
   * answer, "which of these is which", stopped being answerable. */
  const g = newGame('order-tint');
  for (const n of ['Ash', 'Bru', 'Cad']) {
    g.state.party.members.push(makePlayer(n, 'fighter', initialStats('fighter')));
  }
  assignTints(g.state);
  const before = new Map(g.state.party.members.map((m) => [m.name, m.tint]));
  assert.equal(new Set(before.values()).size, before.size, 'two members share a colour');
  g.reorderParty(3, 0);
  for (const m of g.state.party.members) {
    assert.equal(m.tint, before.get(m.name), m.name + ' changed colour in the shuffle');
  }
});

test('a save from before colours were owned gets them assigned once', () => {
  const g = newGame('order-tint-legacy');
  g.state.party.members.push(makePlayer('Ash', 'thief', initialStats('thief')));
  const raw = JSON.parse(JSON.stringify(g.save()));
  for (const m of raw.party.members) delete m.tint;
  const g2 = newGame('order-tint-legacy-2');
  g2.restore(raw);
  const tints = g2.state.party.members.map((m) => m.tint);
  assert.ok(tints.every((t) => Number.isInteger(t)), 'a member came back colourless: ' + tints);
  assert.equal(new Set(tints).size, tints.length, 'the retrofit doubled up a colour');
});
