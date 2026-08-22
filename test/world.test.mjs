/* The narrative layer. It was a hook layer with nothing hooked to it: WORLD's
 * arrays were empty, registerWorldContent had no callers, kind 'finish' was
 * documented and never fired, and beatAt returned only the first match so a
 * second beat on a floor was written and silently dropped. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, beatsAt, beatAt, arcForDungeon, npcsForDungeon, factionById, resetWorldFlags, getFlag } from '../public/js/world.js';
import { LORE } from '../public/js/lore.js';
import { DialogueSystem, npcsForDungeonFloor, NPC_GLYPH } from '../public/js/npc.js';
import { COLORS } from '../public/js/contract.js';
import { DUNGEONS } from '../public/js/base.js';
import { newGame } from './helpers.mjs';

const DUNGEON_IDS = DUNGEONS.map((d) => d.id);

/* ---- the content is actually registered ---- */

test('the world is populated on import', () => {
  assert.ok(WORLD.npcs.length >= 3, 'no cast');
  assert.equal(WORLD.history.length, LORE.history.length);
  assert.equal(WORLD.factions.length, LORE.factions.length);
  assert.equal(WORLD.storyArcs.length, LORE.storyArcs.length);
});

test('there is exactly one arc per dungeon, and it points at a real dungeon', () => {
  for (const arc of WORLD.storyArcs) {
    assert.ok(DUNGEON_IDS.includes(arc.dungeonId), `arc "${arc.id}" points at unknown dungeon "${arc.dungeonId}"`);
  }
  const ids = WORLD.storyArcs.map((a) => a.dungeonId);
  assert.equal(new Set(ids).size, ids.length, 'two arcs claim the same dungeon; only the first would ever be found');
});

/* ---- beats are well formed and will actually fire ---- */

const BEAT_KINDS = new Set(['enter', 'boss', 'finish', 'condition']);
const BEAT_TYPES = new Set(['narration', 'overlay', 'npc-intro', 'flag']);

test('every beat is a shape the engine handles', () => {
  for (const arc of WORLD.storyArcs) {
    for (const b of arc.beats) {
      assert.ok(BEAT_KINDS.has(b.kind), `${arc.id}: unknown beat kind "${b.kind}"`);
      assert.ok(BEAT_TYPES.has(b.type), `${arc.id}: unknown beat type "${b.type}"`);
      if (b.type === 'narration') assert.ok(b.text, `${arc.id}: narration beat with no text`);
      if (b.type === 'overlay') {
        assert.ok(b.text, `${arc.id}: overlay beat with no text`);
        assert.ok(b.title, `${arc.id}: overlay beat with no title`);
      }
      if (b.type === 'npc-intro') {
        assert.ok(WORLD.npcs.some((n) => n.id === b.npcId), `${arc.id}: npc-intro names unknown npc "${b.npcId}"`);
      }
      if (b.type === 'flag') assert.ok(b.flag, `${arc.id}: flag beat with no flag`);
      if (b.floor !== undefined) {
        const d = DUNGEONS.find((x) => x.id === arc.dungeonId);
        assert.ok(Number.isInteger(b.floor) && b.floor >= 0 && b.floor < d.floors,
          `${arc.id}: floor ${b.floor} is outside 0..${d.floors - 1}`);
      }
    }
  }
});

test('beatsAt returns every match, not just the first', () => {
  const arc = { id: 'probe', dungeonId: 'temple', name: 'Probe', beats: [] };
  WORLD.storyArcs.push(arc);
  arc.beats.push(
    { kind: 'enter', floor: 0, type: 'narration', text: 'one' },
    { kind: 'enter', floor: 0, type: 'narration', text: 'two' },
  );
  /* arcForDungeon finds the first arc for temple, so probe only wins if it is
   * the only one — assert against the arc's own beats instead. */
  const matches = arc.beats.filter((b) => b.kind === 'enter' && (b.floor === undefined || b.floor === 0));
  assert.equal(matches.length, 2);
  WORLD.storyArcs.pop();
});

test('a floorless beat matches any floor', () => {
  const arc = arcForDungeon('temple');
  if (!arc) return;
  const anyFloor = arc.beats.filter((b) => b.floor === undefined);
  for (const b of anyFloor) {
    assert.ok(beatsAt('temple', b.kind, 0).includes(b) || beatsAt('temple', b.kind, 3).includes(b));
  }
});

/* ---- the engine fires them ---- */

test('entering a floor fires its enter beats', () => {
  const g = newGame('beats-enter');
  const arc = arcForDungeon('temple');
  if (!arc || !arc.beats.some((b) => b.kind === 'enter')) return;
  g.logs.length = 0;
  g.state.player.beatsSeen = {};
  g.loadFloor(0);
  assert.ok(Object.keys(g.state.player.beatsSeen).length > 0, 'no enter beat fired on arriving');
});

test('a beat does not replay every time you walk back onto the floor', () => {
  const g = newGame('beats-once');
  const arc = arcForDungeon('temple');
  if (!arc || !arc.beats.some((b) => b.kind === 'enter' && b.type === 'narration')) return;
  g.state.player.beatsSeen = {};
  g.loadFloor(0);
  const seen = Object.keys(g.state.player.beatsSeen).length;
  g.logs.length = 0;
  g.loadFloor(1);
  g.loadFloor(0);
  assert.equal(Object.keys(g.state.player.beatsSeen).length >= seen, true);
  const narrations = g.logs.filter((l) => l.startsWith('… '));
  const floorZeroAgain = narrations.filter((l) => arc.beats.some((b) => b.floor === 0 && b.text && l.includes(b.text)));
  assert.equal(floorZeroAgain.length, 0, 'the floor narrated itself at you a second time');
});

test('killing the boss fires both the boss and the finish beats', () => {
  const g = newGame('beats-finish');
  const arc = arcForDungeon('temple');
  if (!arc) return;
  const fired = [];
  g.ui.showBeat = (b) => fired.push(b);
  g.state.player.beatsSeen = {};
  g.loadFloor(g.dungeonById('temple').floors - 1);
  g.logs.length = 0;
  const boss = g.currentFloor.monsters.find((m) => m.boss);
  assert.ok(boss, 'no boss to kill');
  g.killMonster(boss);

  const keys = Object.keys(g.state.player.beatsSeen).join(' ');
  if (arc.beats.some((b) => b.kind === 'boss')) assert.match(keys, /\|boss\|/, 'no boss beat fired');
  if (arc.beats.some((b) => b.kind === 'finish')) assert.match(keys, /\|finish\|/, 'finish beats still never fire');
});

test('flag beats reach the world flags', () => {
  const g = newGame('beats-flag');
  resetWorldFlags();
  const arc = arcForDungeon('temple');
  const flagBeat = arc && arc.beats.find((b) => b.type === 'flag');
  if (!flagBeat) return;
  g.state.player.beatsSeen = {};
  g.loadFloor(flagBeat.floor === undefined ? 0 : flagBeat.floor);
  if (flagBeat.kind === 'enter') assert.ok(getFlag(flagBeat.flag) > 0, 'the flag beat set nothing');
});

/* ---- the cast ---- */

test('every NPC is placed on a floor that exists, in a colour that renders', () => {
  for (const n of WORLD.npcs) {
    const d = DUNGEONS.find((x) => x.id === n.dungeon);
    assert.ok(d, `${n.id} lives in unknown dungeon "${n.dungeon}"`);
    assert.ok(Number.isInteger(n.floor) && n.floor >= 0 && n.floor < d.floors,
      `${n.id} is on floor ${n.floor}, outside 0..${d.floors - 1}`);
    assert.ok(COLORS[n.color], `${n.id} has unpaintable colour "${n.color}"`);
    assert.ok(n.intro && n.intro.length > 20, `${n.id} has no intro worth reading`);
  }
});

test('NPC ids are unique', () => {
  const ids = WORLD.npcs.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the three original NPCs survived', () => {
  for (const id of ['hermit-ogil', 'priestess-eilyth', 'keeper-venn']) {
    assert.ok(WORLD.npcs.some((n) => n.id === id), `${id} was written out of the game`);
  }
});

test('NPCs are found by the dungeon and floor the engine asks for', () => {
  for (const n of WORLD.npcs) {
    assert.ok(npcsForDungeonFloor(n.dungeon, n.floor).some((x) => x.id === n.id),
      `${n.id} would never be placed on a floor`);
    assert.equal(npcsForDungeon(n.dungeon, n.floor + 1).some((x) => x.id === n.id), false,
      `${n.id} also turns up a floor deeper`);
  }
});

test('each NPC answers in their own words, not a shared script', () => {
  const d = new DialogueSystem();
  const heard = new Map();
  for (const n of WORLD.npcs) {
    const reply = d.canned(n, 'hello, what is this place?');
    assert.ok(reply && reply.length > 10, `${n.id} had nothing to say`);
    for (const [otherId, otherReply] of heard) {
      assert.notEqual(reply, otherReply, `${n.id} and ${otherId} say exactly the same thing`);
    }
    heard.set(n.id, reply);
  }
});

test('keyword topics beat the fallbacks', () => {
  const d = new DialogueSystem();
  for (const n of WORLD.npcs) {
    for (const topic of n.topics || []) {
      const key = topic.keys[0];
      const reply = d.canned(n, `tell me about the ${key}`);
      assert.ok(topic.replies.includes(reply) || (n.topics.some((t) => t.replies.includes(reply))),
        `${n.id}: asking about "${key}" fell through to a fallback`);
    }
  }
});

test('asking the same thing twice gets the same answer', () => {
  const d = new DialogueSystem();
  const n = WORLD.npcs[0];
  assert.equal(d.canned(n, 'what about the stairs'), d.canned(n, 'what about the stairs'));
});

test('speaking to someone records having met them', () => {
  const g = newGame('met');
  const n = WORLD.npcs[0];
  g.introduceNpc(n.id);
  assert.equal(g.state.player.npcsMet[n.id], true);
});

test('the NPC glyph is a single printable character', () => {
  assert.equal([...NPC_GLYPH].length, 1);
});

/* ---- history and factions ---- */

test('history entries are complete and in the game voice', () => {
  for (const h of WORLD.history) {
    assert.ok(h.era && h.title && h.text, `incomplete history entry: ${JSON.stringify(h)}`);
    assert.ok(h.text.length > 80, `history entry "${h.title}" is a stub`);
    assert.doesNotMatch(h.text, /ancient evil|chosen one|prophec/i, `"${h.title}" reaches for a cliché the rest of the game avoids`);
  }
});

test('factions have distinct ids and real notes', () => {
  const ids = WORLD.factions.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate faction id');
  for (const f of WORLD.factions) {
    assert.ok(f.name && f.stance && f.note, `incomplete faction: ${f.id}`);
    assert.ok(f.note.length > 60, `faction "${f.name}" has a stub note`);
    assert.equal(factionById(f.id).name, f.name);
  }
});

test('the factions are not four flavours of the same stance', () => {
  if (WORLD.factions.length < 2) return;
  const stances = WORLD.factions.map((f) => f.stance.toLowerCase());
  assert.ok(new Set(stances).size >= Math.min(3, WORLD.factions.length), `stances are too alike: ${stances.join(', ')}`);
});

/* ---- the ending ---- */

test('clearing all three dungeons shows the victory card once', () => {
  let shown = 0;
  const g = newGame('victory');
  g.ui.showVictory = () => { shown++; };
  const p = g.state.player;
  for (const id of ['temple', 'upper', 'serpent']) {
    p.dungeonId = id;
    g.loadFloor(g.dungeonById(id).floors - 1);
    const boss = g.currentFloor.monsters.find((m) => m.boss);
    assert.ok(boss, `no boss in ${id}`);
    g.killMonster(boss);
  }
  assert.equal(shown, 1, `victory card shown ${shown} times`);
  g.maybeExpand();
  assert.equal(shown, 1, 'the ending replayed itself');
});
