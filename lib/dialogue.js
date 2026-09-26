/* THE VOICE, server side.
 *
 * The prompt itself lives in public/js/voice.js (browser-safe, so a local model
 * can use the same one). This module is only the endpoint's half: look up the
 * person, build the prompt, call the bound oracle. Nothing here runs without an
 * oracle bound, and with none the client keeps its canned lines.
 */

import { getNPC } from '../public/js/world.js';
import { buildDialogueSystemPrompt, buildDialogueMessages, endCleanly } from '../public/js/voice.js';
import { callOracleChat } from './oracle.js';

/* Throws a coded error the endpoint turns into a status, so the client falls
 * back to the canned line cleanly. */
export async function dialogueReply(state, body = {}) {
  /* The server's own lore wins when it has the person — it is authoritative
   * and cannot be tampered with. A town resident is not in it (they are built
   * in mapgen on the client), so fall back to the card the client sent. */
  const npc = (body.npcId && getNPC(body.npcId)) || (body.npc && body.npc.name ? body.npc : null);
  if (!npc) {
    const err = new Error('no such person here');
    err.status = 404;
    throw err;
  }
  const system = buildDialogueSystemPrompt(npc, {
    standing: body.standing,
    where: body.where,
    register: body.register,
  });
  /* No system in the messages here — buildChatRequest lays the system prompt on
   * its own, and two of them would only confuse a small model. */
  const messages = buildDialogueMessages(body);
  const reply = await callOracleChat(state, system, messages, {
    maxTokens: 400, temperature: 0.85, timeoutMs: 60_000,
  });
  return { reply: endCleanly(String(reply || '')).slice(0, 800) };
}
