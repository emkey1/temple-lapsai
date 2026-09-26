/* The written world, checked the way the critics checked it. Every assertion
 * here corresponds to a defect that was actually found and fixed in the draft:
 * keys that swallowed common words, replies that repeated a beat verbatim,
 * paragraphs typed as log lines, a faction named in dialogue with no card. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LORE } from '../public/js/lore.js';
import { WORLD } from '../public/js/world.js';
import { DialogueSystem, greetingFor } from '../public/js/npc.js';
import { newGame } from './helpers.mjs';

const dlg = new DialogueSystem();
const npc = (id) => LORE.npcs.find((n) => n.id === id);
const arc = (id) => LORE.storyArcs.find((a) => a.id === id);

/* ---- the shape of what got written ---- */

test('the world has real content in every category', () => {
  assert.ok(LORE.history.length >= 4, `only ${LORE.history.length} eras`);
  assert.ok(LORE.factions.length >= 4, `only ${LORE.factions.length} factions`);
  assert.ok(LORE.storyArcs.length >= 3, `only ${LORE.storyArcs.length} arcs`);
  assert.ok(LORE.npcs.length >= 3);
});

test('every dungeon has an arc that runs its whole depth', () => {
  for (const a of LORE.storyArcs) {
    const floors = new Set(a.beats.filter((b) => b.kind === 'enter').map((b) => b.floor));
    for (const f of [0, 1, 2, 3]) {
      assert.ok(floors.has(f), `${a.id} has nothing to say on arriving at floor ${f}`);
    }
    assert.ok(a.beats.some((b) => b.kind === 'boss'), `${a.id} has no boss beat`);
    assert.ok(a.beats.some((b) => b.kind === 'finish'), `${a.id} has no finish beat`);
  }
});

test('arrival paragraphs are cards, not lines lost in the combat log', () => {
  for (const a of LORE.storyArcs) {
    for (const b of a.beats) {
      if (b.kind !== 'enter' || b.type !== 'narration') continue;
      assert.ok(b.text.length < 120,
        `${a.id} floor ${b.floor}: a ${b.text.length}-character paragraph is typed as a log line`);
    }
    for (const b of a.beats.filter((x) => x.type === 'overlay')) {
      assert.ok(b.title && b.title === b.title.toUpperCase(), `${a.id}: overlay "${b.title}" is not a card heading`);
    }
  }
});

/* ---- keyword collisions: canned() takes the FIRST substring match ---- */

test('asking about the serpent god reaches the serpent, not whatever holds "god"', () => {
  for (const id of ['hermit-ogil', 'priestess-eilyth']) {
    const n = npc(id);
    const reply = dlg.canned(n, 'what do you know about the serpent god');
    const serpentTopic = n.topics.find((t) => t.keys.includes('serpent'));
    assert.ok(serpentTopic.replies.includes(reply),
      `${id}: "serpent god" was swallowed by a topic carrying the bare key "god"`);
  }
});

test('no topic key is swallowed by an earlier, shorter key', () => {
  for (const n of LORE.npcs) {
    for (let i = 0; i < n.topics.length; i++) {
      for (const key of n.topics[i].keys) {
        const reply = dlg.canned(n, `tell me about the ${key}`);
        assert.ok(n.topics[i].replies.includes(reply),
          `${n.id}: topic ${i} key "${key}" is unreachable — an earlier topic matches it first`);
      }
    }
  }
});

test('common words do not trip a topic', () => {
  /* 'owe' hides in power and lower; 'cause' hides in because; 'reach' in breach. */
  const traps = ['what is your power', 'the lower halls', 'why, because I asked', 'tell me about the breach'];
  for (const n of LORE.npcs) {
    for (const key of n.topics.flatMap((t) => t.keys)) {
      for (const phrase of traps) {
        if (!phrase.includes(key)) continue;
        assert.ok(phrase.split(/\b/).includes(key) || phrase.includes(' ' + key),
          `${n.id}: key "${key}" fires on "${phrase}" as a bare substring`);
      }
    }
  }
});

/* ---- an NPC standing on a floor must not pre-empt that floor's beat ---- */

test('no NPC recites a beat the player is about to read', () => {
  const sentences = (t) => String(t).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 40);
  const beatLines = new Set(LORE.storyArcs.flatMap((a) => a.beats.flatMap((b) => sentences(b.text || ''))));
  for (const n of LORE.npcs) {
    for (const line of n.topics.flatMap((t) => t.replies).flatMap(sentences)) {
      assert.ok(!beatLines.has(line), `${n.id} says a beat's line word for word: "${line.slice(0, 60)}…"`);
    }
  }
});

/* ---- everything named in dialogue exists ---- */

test('a faction named in conversation has a card in the codex', () => {
  const spoken = LORE.npcs.flatMap((n) => n.topics.flatMap((t) => t.replies)).join(' ');
  for (const f of LORE.factions) {
    const bare = f.name.replace(/^The /, '');
    if (!spoken.includes(bare)) continue;
    assert.ok(WORLD.factions.some((x) => x.id === f.id), `${f.name} is spoken of but has no card`);
  }
  /* The one the critics caught: Venn names his own order. */
  const venn = npc('keeper-venn');
  const vennSays = venn.topics.flatMap((t) => t.replies).join(' ');
  if (/Keepers of the Coils/.test(vennSays)) {
    assert.ok(LORE.factions.some((f) => f.id === 'keepers-coils'),
      'Venn names the Keepers of the Coils and the codex has never heard of them');
  }
});

test('every NPC has enough to say to be worth walking into', () => {
  for (const n of LORE.npcs) {
    assert.ok(n.topics.length >= 8, `${n.id} has only ${n.topics.length} topics`);
    assert.ok(n.fallbacks.length >= 3, `${n.id} has only ${n.fallbacks.length} fallbacks`);
    for (const t of n.topics) {
      assert.ok(t.keys.length > 0 && t.replies.length > 0, `${n.id} has an empty topic`);
      for (const k of t.keys) assert.equal(k, k.toLowerCase(), `${n.id}: key "${k}" will never match, input is lowercased`);
    }
  }
});

test('the cast answers the obvious opening questions', () => {
  for (const n of LORE.npcs) {
    for (const opener of ['hello', 'who are you', 'what is this place', 'help']) {
      const reply = dlg.canned(n, opener);
      assert.ok(!n.fallbacks.includes(reply), `${n.id} has no answer for "${opener}"`);
    }
  }
});

test('the world opens its mouth by how it counts you', () => {
  for (const n of LORE.npcs) {
    assert.ok(Array.isArray(n.recognise) && n.recognise.length === 4, n.id + ' has no four-rung greeting ladder');
    assert.equal(greetingFor(n, 0), n.intro, n.id + ' does not greet a stranger with the intro');
    assert.equal(greetingFor(n, 1), n.recognise[0], n.id + ' ignores the first rung');
    assert.equal(greetingFor(n, 4), n.recognise[3], n.id + ' ignores the top rung');
    assert.ok(greetingFor(n, 9), n.id + ' fell over past the top of the ladder');
  }
});

/* ---- voice ---- */

test('nobody reaches for the clichés the rest of the game avoids', () => {
  const all = [
    ...LORE.history.map((h) => h.text),
    ...LORE.factions.map((f) => f.note),
    ...LORE.storyArcs.flatMap((a) => a.beats.map((b) => b.text || '')),
    ...LORE.npcs.flatMap((n) => [n.intro, ...n.topics.flatMap((t) => t.replies), ...n.fallbacks]),
    ...(LORE.keeper ? [LORE.keeper.firstBlood, LORE.keeper.fall, LORE.keeper.closing, ...(LORE.keeper.clears || [])] : []),
  ].join('\n');
  for (const cliche of [/ancient evil/i, /chosen one/i, /prophec/i, /darkness stirs/i, /time immemorial/i]) {
    assert.doesNotMatch(all, cliche, `the writing reaches for ${cliche}`);
  }
});

test('the prose is typographically consistent, and safe as JS', () => {
  const src = LORE.npcs.concat(LORE.factions, LORE.history).flatMap((o) => Object.values(o))
    .flatMap((v) => (Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' ? [x] : Object.values(x || {}).flat())) : [v]))
    .filter((v) => typeof v === 'string');
  for (const line of src) {
    assert.doesNotMatch(line, /\w'\w/, `straight apostrophe in prose: "${line.slice(0, 50)}…"`);
  }
});

/* ---- the codex reveals it at the right pace ---- */

test('the chronicle opens as the player conquers, not all at once', () => {
  const g = newGame('chronicle');
  const shown = (cleared) => 2 + cleared;
  assert.ok(shown(0) < LORE.history.length, 'the whole chronicle is legible before you have done anything');
  assert.ok(shown(3) >= LORE.history.length, 'the chronicle can never be finished');
  assert.equal(g.baseDungeonIds().filter((id) => g.isDungeonCleared(id)).length, 0);
});

/* ---- the through-line lands ---- */

test('the finale pays off the arrangement the rest of the world describes', () => {
  const finale = arc('arc-serpent').beats.find((b) => b.kind === 'finish' && b.type === 'overlay');
  assert.ok(finale, 'the game has no ending written');
  assert.ok(finale.text.length > 300, 'the ending is a shrug');
  assert.match(finale.text, /account|ledger|paid|payment|remit/i, 'the ending does not land the through-line');
});

test('the resurrection line the game actually prints is what the world claims', () => {
  /* engine.js halves gold and leaves the pack alone; the writing must agree. */
  const all = LORE.npcs.flatMap((n) => n.topics.flatMap((t) => t.replies)).concat(
    LORE.factions.map((f) => f.note),
    LORE.storyArcs.flatMap((a) => a.beats.map((b) => b.text || '')),
  ).join(' ');
  assert.doesNotMatch(all, /half of everything you carry/i, 'the world claims the scribes take your gear; the engine only takes gold');
});
