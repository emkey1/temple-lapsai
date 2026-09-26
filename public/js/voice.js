/* THE VOICE — the prompt that turns a character card into a speaking part.
 *
 * One description of who an NPC is, in one place: the server builds it from the
 * lore (and from the card the client sends for a town resident, who is not in
 * the lore) and hands it to a bound oracle. Pure and DOM-free, so a test can
 * hold it still without a key or a socket.
 *
 * Nothing here runs unless an oracle is bound; with none, the game keeps its
 * canned lines and never calls this.
 */

import { getNPC, getFaction, loreBriefing } from './world.js';

const RULES = [
  'Stay entirely in character. You are a person in a turn-based dungeon-crawler, not a narrator.',
  'Speak only as yourself: never write the player’s words or actions, never narrate, and never mention AI, models, prompts, or that this is a game.',
  'You are exactly who your description says, and nothing else. Never claim to run, own, or work at any place, and never sell rooms, food, gear, magic or healing, unless your own description says you do. You may speak well of a place you know of, but you do not run it.',
  'Say only what is in your description and what you know. Invent no other people, places, numbers or events.',
  'Keep replies to one to three sentences. Be dry, specific and a little oblique. You always have your own wants.',
  'The vocabulary of this world is commercial, not mythic: account, ledger, arrears, rate, remit, tally, in kind.',
  'Never use the words “ancient evil”, “chosen one”, “prophecy”, “darkness stirs” or “time immemorial”.',
].join(' ');

/* WHAT THE NPC KNOWS, from their own topics — the same material the canned
 * matcher reads, offered to the model as things they can speak to. */
export function npcKnowledge(npc) {
  return (npc.topics || []).map((t) => {
    const keys = (t.keys || []).join(' / ');
    const reply = (t.replies || [])[0] || '';
    return '- ' + keys + ': ' + reply;
  }).join('\n');
}

export function buildDialogueSystemPrompt(npc, opts = {}) {
  if (!npc) return '';
  const faction = npc.faction ? getFaction(npc.faction) : null;
  const stand = opts.standing || 'a stranger';
  const where = opts.where ? 'You are met at ' + opts.where + '.' : '';
  const register = opts.register || loreBriefing({ budget: 700 });
  const knowledge = npcKnowledge(npc);

  return [
    'You are ' + npc.name + ', ' + (npc.title || 'a denizen of the dark') + '.',
    RULES,
    '',
    'WHO YOU ARE',
    npc.intro || '',
    knowledge ? 'WHAT YOU KNOW (things you have heard, seen or think — not services you provide; answer only from this, and do not know what is not here):\n' + knowledge : '',
    faction ? 'YOUR ORDER: ' + faction.name + ' — ' + (faction.stance || '') + '. ' + (faction.note || '') : '',
    'The company stands with your order as ' + stand + '.',
    where,
    register ? 'THE WORLD (for your own reference; do not recite it):\n' + register : '',
  ].filter(Boolean).join('\n');
}

/* The history the model sees: the last few turns, oldest first. Trimmed hard —
 * a small model drowns in context and starts repeating itself. */
export function trimHistory(history, turns = 8) {
  const list = Array.isArray(history) ? history.filter((m) => m && m.text != null) : [];
  return list.slice(-turns);
}

/* The wire messages a chat completion wants: role-mapped history, then the new
 * line. Shared by the server path and the local model. */
export function buildDialogueMessages(body = {}, system) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const m of trimHistory(body.history)) {
    messages.push({ role: m.role === 'npc' ? 'assistant' : 'user', content: String(m.text) });
  }
  const input = String(body.input || '').slice(0, 500).trim();
  messages.push({ role: 'user', content: input || '…' });
  return messages;
}
