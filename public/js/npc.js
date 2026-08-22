/* NPCs and dialogue.
 *
 * The cast itself lives in lore.js and is registered through world.js — this
 * module is the dialogue machinery. It used to keep a second, separate list of
 * NPCs, which meant WORLD.npcs was populated by nobody and read by nothing.
 *
 * Replies come from each NPC's own `topics` (keyword-matched) and `fallbacks`.
 * A dialogue ADAPTER can be installed with setAdapter to route conversation
 * through an LLM instead; without one the canned material answers.
 */

import { WORLD, getNPC, npcsForDungeon } from './world.js';

export const NPC_GLYPH = '¶';

export function getNPCTemplate(id) {
  return getNPC(id);
}

/* floorIdx is zero-based, as the engine counts floors. */
export function npcsForDungeonFloor(dungeonId, floorIdx) {
  return npcsForDungeon(dungeonId, floorIdx);
}

export function allNPCs() {
  return WORLD.npcs;
}

/* ---- dialogue ---- */

export class DialogueSystem {
  constructor() {
    this.adapter = null; // future: async (ctx) => text, wired to an LLM
    this.history = {};   // npcId -> [{role:'player'|'npc', text}]
    this.activeId = null;
  }

  setAdapter(fn) { this.adapter = fn; }

  start(npc) {
    this.activeId = npc.id;
    if (!this.history[npc.id]) this.history[npc.id] = [{ role: 'npc', text: npc.intro }];
    return this.history[npc.id];
  }

  async talk(npc, player, input) {
    const hist = this.history[npc.id] = this.history[npc.id] || [{ role: 'npc', text: npc.intro }];
    hist.push({ role: 'player', text: input });
    let reply;
    if (this.adapter) {
      try {
        reply = await this.adapter({ npc, player, history: hist, input });
      } catch (err) {
        reply = `The ${npc.title} falls silent, their words lost to the dark. (${err.message || 'oracle unreachable'})`;
      }
    } else {
      reply = this.canned(npc, input);
    }
    hist.push({ role: 'npc', text: reply });
    return hist;
  }

  /* First topic whose keys appear in what the player typed. Each NPC carries
   * their own; the old version shared one hard-coded list of three tips across
   * the whole cast, so everyone said the same things in the same words. */
  canned(npc, input) {
    const lower = String(input || '').toLowerCase();
    const topics = npc.topics || [];
    for (const topic of topics) {
      const keys = topic.keys || [];
      if (keys.some((k) => k && lower.includes(String(k).toLowerCase()))) {
        return pick(topic.replies, lower);
      }
    }
    const fallbacks = npc.fallbacks && npc.fallbacks.length
      ? npc.fallbacks
      : ['They look at you, and go back to what they were doing.'];
    return pick(fallbacks, lower);
  }
}

/* Deterministic in what the player typed, so asking the same thing twice gets
 * the same answer and asking a new thing gets a new one. */
function pick(list, seedText) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return '…';
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

export const dialogue = new DialogueSystem();
