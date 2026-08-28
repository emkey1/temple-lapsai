/* THE UNDERTAKINGS.
 *
 * The lore was full of hooks that went nowhere — Ogil "still owed" by the
 * salvage families, Venn's thirty-year question about the carved hands —
 * because there was writing for quests and no machinery. These pin the
 * machinery: offered under conditions, taken, tracked through play,
 * closed by the person who asked, and paid for. And, because this game
 * has learned the lesson four times over: an undertaking belongs to the
 * COMPANY, not to whoever happened to be holding the reins.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from './helpers.mjs';
import { makePlayer, initialStats } from '../public/js/engine.js';
import { QUESTS, questById, questsFrom, objectiveText } from '../public/js/quests.js';
import { getItemTemplate } from '../public/js/base.js';
import { deepItem } from '../public/js/dice.js';

function rig(seed = 'q') {
  const g = newGame(seed, 'fighter');
  g.loadFloor(0);
  g.currentFloor.monsters.length = 0;
  return { g, p: g.state.player };
}

test('every quest names a giver who exists, and an objective the engine can read', async () => {
  const { WORLD } = await import('../public/js/world.js');
  const kinds = new Set(['slay', 'gather', 'reach']);
  for (const q of QUESTS) {
    assert.ok(q.id && q.name, 'a quest without a name');
    assert.ok(WORLD.npcs.some((n) => n.id === q.giver), q.id + ' is given by nobody: ' + q.giver);
    assert.ok(q.objective && kinds.has(q.objective.kind), q.id + ' has no readable objective');
    assert.ok(q.offer && q.done, q.id + ' has nothing to say');
    if (q.requires) assert.ok(questById(q.requires.quest), q.id + ' requires a quest that does not exist');
  }
});

test('a gather quest is offered, taken, carried and closed', () => {
  const { g, p } = rig('q-gather');
  const q = questById('idols-for-ogil');
  assert.deepEqual(g.questsOnOffer('hermit-ogil').map((x) => x.id).includes(q.id), true);
  assert.ok(g.acceptQuest(q.id));
  assert.equal(g.questState(q.id), 'active');
  assert.equal(g.questsOnOffer('hermit-ogil').some((x) => x.id === q.id), false, 'offered again after taking');

  /* Not yet — and the giver has nothing to collect. */
  assert.equal(g.questSatisfied(q), false);
  assert.equal(g.questsToClose('hermit-ogil').length, 0);
  assert.equal(g.completeQuest(q.id), false, 'closed with nothing in hand');

  for (let i = 0; i < 3; i++) p.inventory.push(deepItem(getItemTemplate('statuette')));
  assert.equal(g.questProgressOf(q), 3);
  assert.ok(g.questSatisfied(q));
  const purse = g.purse();
  assert.ok(g.completeQuest(q.id));
  assert.equal(g.questState(q.id), 'done');
  assert.equal(g.purse(), purse + q.reward.gold, 'the coin never came');
  assert.equal(p.inventory.filter((it) => it.id === 'statuette').length, 0, 'the godlings were not handed over');
});

test('what the company carries counts, wherever it is carried', () => {
  const { g, p } = rig('q-company');
  const buddy = makePlayer('Porter', 'thief', initialStats('thief'));
  buddy.dungeonId = p.dungeonId; buddy.floorIdx = p.floorIdx; buddy.gold = 0;
  g.state.party.members.push(buddy);
  g.acceptQuest('idols-for-ogil');
  for (let i = 0; i < 2; i++) buddy.inventory.push(deepItem(getItemTemplate('statuette')));
  p.inventory.push(deepItem(getItemTemplate('statuette')));
  const q = questById('idols-for-ogil');
  assert.equal(g.questProgressOf(q), 3, 'a companion’s pack did not count');
  assert.ok(g.completeQuest(q.id));
  assert.equal(buddy.inventory.filter((it) => it.id === 'statuette').length, 0, 'the porter kept the goods');
});

test('a slay quest counts only what dies after it was taken', () => {
  const { g, p } = rig('q-slay');
  const q = questById('the-demons-account');
  /* It is Ogil's second asking, so his first must be closed. */
  g.acceptQuest('idols-for-ogil');
  for (let i = 0; i < 3; i++) p.inventory.push(deepItem(getItemTemplate('statuette')));
  g.completeQuest('idols-for-ogil');
  /* A kill before the asking is not the asking's. */
  g.questKilled('lapsai-demon');
  assert.ok(g.acceptQuest(q.id));
  assert.equal(g.questProgressOf(q), 0, 'an earlier kill was counted');
  g.questKilled('sewer-rat');
  assert.equal(g.questProgressOf(q), 0, 'the wrong corpse counted');
  g.questKilled('lapsai-demon');
  assert.ok(g.questSatisfied(q));
  assert.equal(g.questsToClose('hermit-ogil').map((x) => x.id)[0], q.id);
});

test('a reach quest closes on arriving, and not before', () => {
  const { g } = rig('q-reach');
  const q = questById('venns-question');
  assert.ok(g.questsOnOffer('keeper-venn').some((x) => x.id === q.id));
  g.acceptQuest(q.id);
  g.questReached('serpent', 1);
  assert.equal(g.questSatisfied(q), false, 'a shallow floor satisfied it');
  g.questReached('serpent', 3);
  assert.ok(g.questSatisfied(q));
});

test('gates hold: a chained quest waits for its parent and its dungeon', () => {
  const { g, p } = rig('q-gates');
  const offered = () => g.questsOnOffer('hermit-ogil').map((x) => x.id);
  assert.equal(offered().includes('the-demons-account'), false, 'the second asking came before the first');
  assert.equal(offered().includes('the-long-account'), false);

  g.acceptQuest('idols-for-ogil');
  for (let i = 0; i < 3; i++) p.inventory.push(deepItem(getItemTemplate('statuette')));
  g.completeQuest('idols-for-ogil');
  assert.ok(offered().includes('the-demons-account'), 'the chain never opened');

  /* The last link needs its parent AND the Upper Reaches behind you. */
  assert.equal(offered().includes('the-long-account'), false, 'the last link opened early');
  g.acceptQuest('the-demons-account');
  g.questKilled('lapsai-demon');
  g.completeQuest('the-demons-account');
  assert.equal(offered().includes('the-long-account'), false, 'the dungeon gate was ignored');
  p.bossesSlain.upper = true;
  assert.ok(offered().includes('the-long-account'), 'the last link never opened');
});

test('an undertaking belongs to the company and survives the save', () => {
  const { g } = rig('q-save');
  g.acceptQuest('venns-question');
  g.questReached('serpent', 3);
  const raw = JSON.parse(JSON.stringify(g.save()));
  const g2 = newGame('q-save-2', 'fighter');
  g2.restore(raw);
  assert.equal(g2.questState('venns-question'), 'active', 'the undertaking was forgotten');
  assert.ok(g2.questSatisfied(questById('venns-question')), 'the progress was forgotten');
});

test('the objective line says something true at every stage', () => {
  const { g, p } = rig('q-text');
  const q = questById('idols-for-ogil');
  g.acceptQuest(q.id);
  assert.match(objectiveText(q, 0), /0\/3/);
  p.inventory.push(deepItem(getItemTemplate('statuette')));
  assert.match(objectiveText(q, g.questProgressOf(q)), /1\/3/);
});

test('every giver stands where a player can actually reach them', async () => {
  /* The failure this guards: a quest whose giver exists in the lore but
   * lives somewhere the player never goes, or whose objective is already
   * satisfied by the time they can be met. Both happened on the first
   * draft — Eilyth asking for a boss you must have killed to reach her. */
  const { WORLD } = await import('../public/js/world.js');
  const { npcsForDungeonFloor } = await import('../public/js/npc.js');
  const { DUNGEONS } = await import('../public/js/base.js');
  const order = DUNGEONS.map((d) => d.id);
  for (const q of QUESTS) {
    const n = WORLD.npcs.find((x) => x.id === q.giver);
    assert.ok(npcsForDungeonFloor(n.dungeon, n.floor).some((x) => x.id === n.id),
      q.id + ': ' + n.id + ' never spawns on ' + n.dungeon + ' floor ' + n.floor);
    const o = q.objective;
    /* The objective must lie AHEAD of the giver, not behind them: the
     * dungeon it points at is theirs or deeper in the world's order. */
    const target = o.dungeon || (o.kind === 'slay'
      ? (DUNGEONS.find((d) => d.bossId === o.monster) || {}).id
      : null);
    if (!target) continue;
    assert.ok(order.indexOf(target) >= order.indexOf(n.dungeon),
      q.id + ' asks for something in ' + target + ', behind its giver in ' + n.dungeon);
  }
});

test('the deep entrance is a choice, so a hand-in is never a climb', () => {
  const { g } = rig('q-depth');
  const p = g.state.player;
  p.deepest = { temple: 3 };
  let asked = null;
  g.ui.askDepth = (d, known, go) => { asked = { id: d.id, known }; go(0); };
  g.enterDungeon('temple');
  assert.deepEqual(asked, { id: 'temple', known: 3 }, 'the player was never asked');
  assert.equal(p.floorIdx, 0, 'the choice was ignored');
});
