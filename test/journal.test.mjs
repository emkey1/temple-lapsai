/* THE JOURNAL: the run, told back to its owner. What gets ink, what does
 * not, and that memory stays memory-sized. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { hireMember } from '../public/js/town.js';

test('first arrivals and levels earn their lines', () => {
  const g = newGame('jr-1');
  const texts = () => (g.state.journal || []).map((e) => e.text).join(' | ');
  assert.match(texts(), /first set foot in The Temple of Lapsai/, 'the founding arrival went unrecorded');
  g.levelUp(g.state.player);
  assert.match(texts(), /reached level 2/, 'a level without ink');
});

test('a hire is worth remembering, with the price', () => {
  const g = newGame('jr-hire');
  g.state.player.gold = 5000;
  hireMember(g, 'mage');
  assert.match((g.state.journal || []).at(-1).text, /joined the company for \d+ gold/);
});

test('entries carry a where, and the book stays memory-sized', () => {
  const g = newGame('jr-cap');
  for (let i = 0; i < 250; i++) g.journal('entry ' + i);
  assert.equal(g.state.journal.length, 200, 'the journal grew past memory');
  assert.equal(g.state.journal.at(-1).text, 'entry 249');
  assert.ok(g.state.journal.at(-1).where.length > 0, 'an entry from nowhere');
});

test('an old save opens a fresh book rather than crashing', () => {
  const g = newGame('jr-legacy');
  const save = JSON.parse(JSON.stringify(g.state));
  delete save.journal;
  const g2 = newGame('jr-legacy2');
  g2.restore(save);
  g2.journal('the first line of the new book');
  assert.equal(g2.state.journal.length, 1);
});
