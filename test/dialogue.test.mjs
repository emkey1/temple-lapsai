/* THE VOICE. The system prompt a voice is handed is built from the lore itself,
 * so it cannot go stale when the writing grows. Held still here without a key,
 * a socket, or a model. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDialogueSystemPrompt, npcKnowledge, trimHistory, buildDialogueMessages } from '../public/js/voice.js';
import { getNPC } from '../public/js/world.js';

test('the prompt is built from the NPC’s own lore, not written beside it', () => {
  const npc = getNPC('hermit-ogil');
  const sys = buildDialogueSystemPrompt(npc, { standing: 'noticed', where: 'the Temple door' });
  assert.match(sys, /You are Ogil the Whetstone/);
  assert.ok(sys.includes(npc.intro), 'the prompt dropped the introduction');
  assert.match(sys, /Carriers of Ubtao/, 'the prompt does not name the NPC’s order');
  assert.match(sys, /noticed/, 'the company’s standing is never told to the voice');
  assert.match(sys, /the Temple door/, 'the prompt does not say where they are met');
  /* The rules the rest of the game keeps are stated to the model too. */
  assert.match(sys, /never mention AI/);
  assert.match(sys, /ancient evil/);
});

test('what the NPC knows is offered from its own topics', () => {
  const k = npcKnowledge(getNPC('hermit-ogil'));
  assert.ok(k.length > 0 && k.startsWith('- '), 'no knowledge was offered to the voice');
});

test('the history is trimmed and role-mapped for the wire', () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'player' : 'npc', text: 'line ' + i }));
  assert.equal(trimHistory(long, 8).length, 8, 'the history was not trimmed');
  const noSys = buildDialogueMessages({ history: [{ role: 'npc', text: 'hi' }], input: 'hello' });
  assert.deepEqual(noSys, [{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'hello' }]);
  const withSys = buildDialogueMessages({ history: [], input: 'hello' }, 'SYSTEM');
  assert.deepEqual(withSys[0], { role: 'system', content: 'SYSTEM' });
});

test('an NPC with no id builds nothing rather than throwing', () => {
  assert.equal(buildDialogueSystemPrompt(null), '');
});

test('the compact prompt drops the briefing and says who is speaking', () => {
  const npc = getNPC('hermit-ogil');
  const full = buildDialogueSystemPrompt(npc, { standing: 'noticed' });
  const compact = buildDialogueSystemPrompt(npc, { standing: 'noticed', compact: true });
  assert.ok(compact.length < full.length / 2, 'compact is not markedly shorter than the full briefing');
  assert.match(compact, /Reply ONLY as Ogil the Whetstone/, 'compact does not pin the speaker');
  assert.match(compact, /first person/i, 'compact does not ask for the first person');
  assert.match(compact, /Invent NOTHING/i, 'compact does not forbid invention');
  assert.doesNotMatch(compact, /THE WORLD \(for your own reference/, 'compact still carries the world register');
});
