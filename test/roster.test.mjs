/* The ledger.
 *
 * The game kept exactly one save under one key, so rolling a new adventurer
 * quietly wrote over the last one — and there was no way to find that out
 * except by doing it. All of this lives away from the DOM precisely so it can
 * be checked here rather than by hand in a browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import {
  LEDGER_KEY, LEGACY_SLOT, slotKey, newCharId, summarise,
  readLedger, writeLedger, rememberCharacter, readCharacter, forgetCharacter,
  markFallen, pickLast, playable, adoptLegacySave,
} from '../public/js/roster.js';

/* localStorage, near enough: string in, string out, and it can be made to
 * fail the way a full quota does. */
function fakeStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    full: false,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { if (this.full) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const saveOf = (name, cls = 'fighter', level = 1) => {
  const g = newGame('ledger-' + name, cls);
  const p = g.state.player;
  p.name = name;
  p.level = level;
  return { data: { v: 2, saved: 1000, state: g.save(), registry: {} }, player: p, game: g };
};

function put(store, id, name, opts = {}) {
  const { data, player } = saveOf(name, opts.cls, opts.level);
  return rememberCharacter(store, id, data, summarise(player, opts.where), opts.savedAt || 1000);
}

/* ---- ids and summaries ---- */

test('two adventurers rolled in the same millisecond get different records', () => {
  const a = newCharId(1700000000000, 0.11);
  const b = newCharId(1700000000000, 0.87);
  assert.notEqual(a, b);
  assert.notEqual(slotKey(a), slotKey(b));
});

test('a summary says who they are without opening the record', () => {
  const { player } = saveOf('Marlyle', 'thief', 4);
  const s = summarise(player, 'The Temple of Lapsai');
  assert.equal(s.name, 'Marlyle');
  assert.equal(s.cls, 'thief');
  assert.equal(s.level, 4);
  assert.equal(s.where, 'The Temple of Lapsai');
  assert.ok(s.floor >= 1, 'floors are shown one-based, as the game shows them');
});

/* ---- the thing this replaces ---- */

test('a new adventurer does not write over the last one', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  put(store, 'c2', 'Brant');
  const names = playable(store).map((c) => c.name).sort();
  assert.deepEqual(names, ['Brant', 'Marlyle']);
  assert.ok(readCharacter(store, 'c1'), 'the first record was overwritten');
  assert.ok(readCharacter(store, 'c2'));
});

test('saving the same adventurer again updates them rather than duplicating', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle', { level: 1, savedAt: 1000 });
  put(store, 'c1', 'Marlyle', { level: 5, savedAt: 2000 });
  const rows = playable(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, 5);
});

/* ---- which one CONTINUE opens ---- */

test('continue opens the one played last', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle', { savedAt: 1000 });
  put(store, 'c2', 'Brant', { savedAt: 2000 });
  assert.equal(pickLast(store), 'c2');
  put(store, 'c1', 'Marlyle', { savedAt: 3000 });
  assert.equal(pickLast(store), 'c1');
});

test('continue falls back when the last record is gone', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle', { savedAt: 1000 });
  put(store, 'c2', 'Brant', { savedAt: 2000 });
  store.removeItem(slotKey('c2'));
  assert.equal(pickLast(store), 'c1', 'continue pointed at a record that is not there');
});

test('with nobody in the ledger there is nothing to continue', () => {
  assert.equal(pickLast(fakeStore()), null);
  assert.deepEqual(playable(fakeStore()), []);
});

test('a name whose record has vanished is not offered', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  store.removeItem(slotKey('c1'));
  assert.deepEqual(playable(store), [], 'the ledger offered a row that cannot be opened');
});

/* ---- erasing ---- */

test('erasing takes the record and the entry together', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  put(store, 'c2', 'Brant');
  forgetCharacter(store, 'c1');
  assert.equal(readCharacter(store, 'c1'), null);
  assert.deepEqual(playable(store).map((c) => c.id), ['c2']);
});

test('erasing the one you played last moves the pointer somewhere real', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle', { savedAt: 1000 });
  put(store, 'c2', 'Brant', { savedAt: 2000 });
  assert.equal(pickLast(store), 'c2');
  forgetCharacter(store, 'c2');
  assert.equal(pickLast(store), 'c1');
});

test('erasing the last of them leaves nothing pointing at nothing', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  forgetCharacter(store, 'c1');
  assert.equal(readLedger(store).last, null);
  assert.equal(pickLast(store), null);
});

/* ---- death ---- */

test('the fallen are marked on the ledger, not in the record', () => {
  /* The record is deliberately not written on the killing blow, so it still
   * says alive. If the ledger did not remember, opening it again would be a
   * free rise — which is exactly what the gold cost exists to prevent. */
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  markFallen(store, 'c1');
  assert.equal(playable(store)[0].fallen, true);
  assert.ok(readCharacter(store, 'c1').state.player, 'the record itself was disturbed');
});

test('saving again does not quietly un-kill someone', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  markFallen(store, 'c1');
  put(store, 'c1', 'Marlyle', { level: 2 });
  assert.equal(playable(store)[0].fallen, true, 'a save cleared the death');
});

test('rising again clears it', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  markFallen(store, 'c1');
  markFallen(store, 'c1', false);
  assert.equal(playable(store)[0].fallen, false);
});

test('marking someone who is not there changes nothing', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  markFallen(store, 'nobody');
  assert.equal(playable(store).length, 1);
  assert.ok(!playable(store)[0].fallen);
});

/* ---- the save that already exists ---- */

test('the one save the game used to keep becomes the first name in the ledger', () => {
  const { data } = saveOf('Old Hand', 'cleric', 6);
  const store = fakeStore({ [LEGACY_SLOT]: JSON.stringify(data) });
  const id = adoptLegacySave(store, 'c-adopted', null, 5000);
  assert.equal(id, 'c-adopted');
  const rows = playable(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Old Hand');
  assert.equal(rows[0].level, 6);
  assert.equal(store.getItem(LEGACY_SLOT), null, 'the old slot was left behind to be adopted twice');
  assert.ok(readCharacter(store, 'c-adopted').state.player, 'the record did not come across');
});

test('adopting nothing is not an error, and does not invent a name', () => {
  const store = fakeStore();
  assert.equal(adoptLegacySave(store, 'c1', null, 0), null);
  assert.deepEqual(playable(store), []);
  const junk = fakeStore({ [LEGACY_SLOT]: 'not json at all' });
  assert.equal(adoptLegacySave(junk, 'c1', null, 0), null);
});

/* ---- a store that refuses ---- */

test('a full disk loses the save, not the ledger that already exists', () => {
  const store = fakeStore();
  put(store, 'c1', 'Marlyle');
  store.full = true;
  assert.doesNotThrow(() => rememberCharacter(store, 'c2', { state: {} }, { name: 'Brant' }, 2000));
  assert.deepEqual(playable(store).map((c) => c.name), ['Marlyle']);
});

test('a ledger written by something else does not take the game down with it', () => {
  for (const junk of ['{{{', 'null', '[]', '{"chars":"no"}', '{"chars":[null,{}]}']) {
    const store = fakeStore({ [LEDGER_KEY]: junk });
    assert.doesNotThrow(() => readLedger(store));
    assert.ok(Array.isArray(readLedger(store).chars));
    assert.deepEqual(playable(store), []);
  }
});

test('what goes into the ledger comes back out of it', () => {
  const store = fakeStore();
  writeLedger(store, { last: 'c9', chars: [{ id: 'c9', name: 'Marlyle' }] });
  const back = readLedger(store);
  assert.equal(back.last, 'c9');
  assert.equal(back.chars[0].name, 'Marlyle');
});
