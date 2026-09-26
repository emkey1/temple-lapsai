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
  const { generateTownFloor, generateReachFloor } = await import('../public/js/mapgen.js');
  /* Townspeople are givers now too, and they are built by the town generators
   * rather than held in the lore, so collect their ids off the built floors. */
  const townIds = new Set([
    ...(generateTownFloor([]).npcs || []),
    ...(generateReachFloor([]).npcs || []),
  ].map((n) => n.tpl.id));
  const known = (id) => WORLD.npcs.some((n) => n.id === id) || townIds.has(id);
  const kinds = new Set(['slay', 'slayAny', 'gather', 'reach', 'deliver', 'altar', 'cleared', 'all']);
  for (const q of QUESTS) {
    assert.ok(q.id && q.name, 'a quest without a name');
    /* A library undertaking is posted, not spoken — it has no giver, and
     * that is allowed; everything else must name a person who exists. */
    if (q.via !== 'library') {
      assert.ok(known(q.giver), q.id + ' is given by nobody: ' + q.giver);
    }
    assert.ok(q.objective && kinds.has(q.objective.kind), q.id + ' has no readable objective');
    assert.ok(q.offer && q.done, q.id + ' has nothing to say');
    if (q.requires) assert.ok(questById(q.requires.quest), q.id + ' requires a quest that does not exist');
    /* A bundled objective is only as readable as its leaves. */
    if (q.objective.kind === 'all') {
      assert.ok(Array.isArray(q.objective.of) && q.objective.of.length >= 2, q.id + ' bundles fewer than two parts');
      for (const leaf of q.objective.of) assert.ok(kinds.has(leaf.kind) && leaf.kind !== 'all', q.id + ' has a part the engine cannot read');
    }
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
    if (q.via === 'library' || !q.giver) continue;   /* posted, not spoken: no one to stand anywhere */
    const n = WORLD.npcs.find((x) => x.id === q.giver);
    /* A townsperson giver is reached by walking the town, not a dungeon floor. */
    if (!n) continue;
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

/* THE POWERS OF THE WORLD, and where you stand with them.
 *
 * Seven factions were written at depth, three of them with a person you can
 * actually meet, and not one of them meant anything: the Codex printed the
 * notes and the game never asked who you had done right by. Standing is
 * company-wide — the seventh time that distinction has mattered — because a
 * favour owed to the woman who carried the idols is not owed to her alone.
 */

test('the people you can meet belong to orders that exist', async () => {
  const { WORLD, getFaction } = await import('../public/js/world.js');
  for (const n of WORLD.npcs) {
    assert.ok(n.faction, n.id + ' belongs to nobody');
    assert.ok(getFaction(n.faction), n.id + ' belongs to an order the world does not have: ' + n.faction);
  }
});

/* Ogil's first undertaking is three carved godlings; the simplest one to
 * satisfy honestly, since it asks only that the company be carrying them. */
function closeOgilsFirst(g) {
  const q = questById('idols-for-ogil');
  g.acceptQuest(q.id);
  const p = g.state.player;
  for (let i = 0; i < q.objective.count; i++) p.inventory.push(deepItem(getItemTemplate(q.objective.item)));
  g.refreshQuestProgress();
  return g.completeQuest(q.id);
}

test('closing an undertaking earns standing with whoever asked', () => {
  const { g } = rig('standing');
  assert.equal(g.standing('carriers-ubtao'), 0, 'known to them before doing anything');
  assert.ok(closeOgilsFirst(g), 'the undertaking would not close');
  assert.equal(g.standing('carriers-ubtao'), 1, 'the favour landed with nobody');
  assert.equal(g.standingRank('carriers-ubtao'), 'noticed');
});

test('and it is the COMPANY that is owed, not the one who spoke', () => {
  const { g } = rig('standing-company');
  const mate = makePlayer('Second', 'thief', initialStats('thief'));
  g.state.party.members.push(mate);
  closeOgilsFirst(g);
  assert.ok(g.state.standing && g.state.standing['carriers-ubtao'] > 0,
    'the reputation went into somebody\u2019s pocket instead of the company\u2019s');
  for (let i = 0; i < g.state.party.members.length; i++) {
    g.state.party.active = i;
    assert.equal(g.standing('carriers-ubtao'), 1, 'standing changed with who was holding the reins');
  }
});

test('the Carriers pay above scrap once they count you', async () => {
  const { sellPrice } = await import('../public/js/town.js');
  const { g } = rig('carriers');
  const goods = deepItem(getItemTemplate('statuette'));
  const before = sellPrice(goods, g);
  g.earnStanding('carriers-ubtao', 2);
  assert.ok(sellPrice(goods, g) > before,
    'the four families count you their own and still pay scrap');
});

test('the Sisters name the channels, and black water stops costing ground', () => {
  const { g, p } = rig('sisters');
  const wades = () => { g.clearActorTurn(p); g.wadeInto(p.x, p.y); return !!g.actorTurn(p).wading; };
  assert.ok(wades(), 'black water was already free before anyone taught anything');
  g.earnStanding('drowned-sisters');
  assert.ok(!wades(), 'the Sisters named the channels and the water still dragged');
});

test('the Keepers keep the survey open, and seams give sooner', async () => {
  const { T } = await import('../public/js/mapgen.js');
  const { g, p } = rig('keepers');
  /* The odds are private, so read them the way the game does: run the same
   * search many times over and count what gives. */
  const found = () => {
    let n = 0;
    for (let t = 0; t < 400; t++) {
      g.currentFloor.tiles[p.y][p.x + 1] = T.SECRET;
      g.turn = t;
      g.searchSecretAt(p.x + 1, p.y);
      if (g.currentFloor.tiles[p.y][p.x + 1] !== T.SECRET) n++;
    }
    return n;
  };
  const cold = found();
  g.earnStanding('keepers-coils', 3);
  const warm = found();
  assert.ok(warm > cold, `standing bought nothing: ${cold} found before, ${warm} after`);
});

/* --- THE WIDENED LEDGER: the machinery the new undertakings run on. --- */

test('a field-closed undertaking (turnIn: false) pays out where you stand', () => {
  const { g } = rig('q-field');
  const q = questById('the-stairs-are-swept');
  assert.equal(q.turnIn, false);
  assert.ok(g.acceptQuest(q.id));
  const purse = g.purse();
  g.questKilled('skeleton');
  g.questKilled('skeleton');
  g.questKilled('skeleton');
  assert.equal(g.questState(q.id), 'active', 'closed a kill early');
  g.questKilled('skeleton');
  /* The fourth greeter drops and the thing closes itself — no climb back. */
  assert.equal(g.questState(q.id), 'done', 'a field-closed undertaking never closed itself');
  assert.equal(g.purse(), purse + q.reward.gold, 'the coin never arrived');
  assert.equal(g.standing('carriers-ubtao'), 1, 'the favour landed with nobody');
});

test('a repeatable bounty pays, hands over the goods, and reopens', () => {
  const { g, p } = rig('q-repeat');
  const q = questById('carriers-standing-order');
  assert.equal(q.repeatable, true);
  assert.ok(g.acceptQuest(q.id));
  for (let cycle = 1; cycle <= 2; cycle++) {
    for (let i = 0; i < q.objective.count; i++) p.inventory.push(deepItem(getItemTemplate('gem')));
    const purse = g.purse();
    assert.ok(g.completeQuest(q.id), 'cycle ' + cycle + ' would not close');
    assert.equal(g.questState(q.id), 'active', 'a repeatable bounty left the list after cycle ' + cycle);
    assert.equal(g.purse(), purse + q.reward.gold, 'cycle ' + cycle + ' was never paid');
    assert.equal(p.inventory.filter((it) => it.id === 'gem').length, 0, 'cycle ' + cycle + ' kept the goods');
  }
  assert.equal(g.questLedger()[q.id].times, 2, 'the count of times stood was not kept');
  assert.equal(g.standing('carriers-ubtao'), 2, 'standing only counted the first favour');
});

test('an undertaking can be set aside and taken up again', () => {
  const { g } = rig('q-abandon');
  const id = 'what-the-sea-returns';
  assert.ok(g.questsOnOffer('priestess-eilyth').some((x) => x.id === id), 'never offered');
  g.acceptQuest(id);
  assert.equal(g.questState(id), 'active');
  assert.ok(g.abandonQuest(id), 'would not let go');
  assert.equal(g.questState(id), 'unoffered', 'a dropped undertaking did not return to the offering');
  assert.ok(g.questsOnOffer('priestess-eilyth').some((x) => x.id === id), 'not offered again');
  assert.ok(g.acceptQuest(id), 'could not be taken up again');
});

test('a cull counts any of its set, and nothing outside it', () => {
  const { g } = rig('q-cull');
  const q = questById('the-legible-entries');
  assert.ok(g.questsOnOffer('tallyman-ress').some((x) => x.id === q.id), 'the tallyman never offered it');
  g.acceptQuest(q.id);
  g.questKilled('skeleton');
  g.questKilled('zombie');
  g.questKilled('ghoul');
  g.questKilled('ghast');
  g.questKilled('rat');
  g.questKilled('otyugh');
  assert.equal(g.questProgressOf(q), 4, 'a rat or an otyugh counted toward the bones');
  assert.equal(g.questSatisfied(q), false, 'satisfied a bone short');
  g.questKilled('ghast');
  assert.ok(g.questSatisfied(q), 'the fifth of the set did not finish the cull');
});

test('a delivery arrives carrying, hands over the goods, and not before', () => {
  const { g, p } = rig('q-deliver');
  const q = questById('the-freight-runs');
  assert.ok(g.questsOnOffer('drain-factor').some((x) => x.id === q.id), 'the factor never offered it');
  g.acceptQuest(q.id);
  g.questReached('upper', 3);
  assert.equal(g.questProgressOf(q), 0, 'delivered with empty hands');
  p.inventory.push(deepItem(getItemTemplate('statuette')));
  g.questReached('upper', 1);
  assert.equal(g.questProgressOf(q), 0, 'delivered on the wrong landing');
  g.questReached('upper', 3);
  assert.ok(g.questSatisfied(q), 'the freight never arrived');
  assert.equal(p.inventory.filter((it) => it.id === 'statuette').length, 0, 'the crate was not handed over');
});

test('a bundled undertaking waits for every part, and pays the named faction', () => {
  const { g, p } = rig('q-bundle');
  /* The Long Arrears is chained behind the tallyman's intro cull. */
  g.acceptQuest('the-legible-entries');
  for (let i = 0; i < 5; i++) g.questKilled('skeleton');
  assert.ok(g.completeQuest('the-legible-entries'));
  assert.equal(g.standing('tallymen'), 1, 'the intro cull paid the wrong order');
  assert.equal(g.standing('standing-order'), 0, 'the garrison was owed before anything was done for it');

  const q = questById('the-long-arrears');
  assert.equal(q.objective.kind, 'all');
  assert.ok(g.acceptQuest(q.id), 'the bundle never opened');
  /* Only the cull part done. */
  for (let i = 0; i < 5; i++) g.questKilled('ghoul');
  assert.equal(g.questSatisfied(q), false, 'a bundle closed on one part of two');
  /* Now the delivery too. */
  p.inventory.push(deepItem(getItemTemplate('crown')));
  p.inventory.push(deepItem(getItemTemplate('crown')));
  g.questReached('serpent', 3);
  assert.ok(g.questSatisfied(q), 'the bundle never saw both parts done');
  assert.equal(g.questProgressOf(q), 2, 'the bundle miscounted its own parts');
  assert.ok(g.completeQuest(q.id));
  assert.equal(g.standing('standing-order'), 1, 'the favour did not answer to the named faction');
  assert.equal(g.standing('tallymen'), 0, 'the tallymen were not cooled by the garrison’s tithe');
  assert.equal(p.inventory.filter((it) => it.id === 'crown').length, 0, 'the tithe was not handed over');
});

test('the altar-rite counts each distinct altar once', () => {
  const { g } = rig('q-altar');
  const q = questById('the-old-words');
  assert.ok(g.questsOnOffer('priestess-eilyth').some((x) => x.id === q.id));
  g.acceptQuest(q.id);
  g.questAltarUsed('temple:0:5,7');
  g.questAltarUsed('temple:0:5,7');
  assert.equal(g.questProgressOf(q), 1, 'the same altar counted twice');
  g.questAltarUsed('upper:1:9,3');
  assert.equal(g.questProgressOf(q), 2);
  assert.equal(g.questSatisfied(q), false);
  g.questAltarUsed('serpent:2:2,11');
  assert.ok(g.questSatisfied(q), 'the third altar did not keep the rite');
});

test('the capstone is posted in the Library, and closes the whole chronicle', () => {
  const { g, p } = rig('q-capstone');
  const q = questById('the-long-account-closed');
  assert.equal(q.via, 'library');
  assert.equal(q.giver, null, 'the Lore-Weavers keep no account of you — no one should give it');
  assert.equal(q.turnIn, false);
  /* Not a dialogue quest: no person offers it, but the Library posts it. */
  assert.equal(g.questsOnOffer('tallyman-ress').some((x) => x.id === q.id), false);
  assert.ok(g.libraryQuestsOnOffer().some((x) => x.id === q.id), 'the Library never posted it');
  assert.ok(g.acceptQuest(q.id));
  assert.equal(g.questSatisfied(q), false, 'the chronicle closed with nothing conquered');
  /* Conquer the three sanctums and the thing closes itself. */
  p.bossesSlain = { temple: true, upper: true, serpent: true };
  const purse = g.purse();
  g.refreshQuestProgress();
  assert.equal(g.questState(q.id), 'done', 'the Long Account did not close when the last sanctum fell');
  assert.ok(g.standing('lore-weavers') > 0, 'the Lore-Weavers never counted the favour');
  assert.ok(p.inventory.some((it) => it.id === 'ring-arcana'), 'the Archive ring never arrived');
});

test('the newly met powers stand where the player can reach them', async () => {
  const { WORLD } = await import('../public/js/world.js');
  const { npcsForDungeonFloor } = await import('../public/js/npc.js');
  const tally = WORLD.npcs.find((n) => n.id === 'tallyman-ress');
  const factor = WORLD.npcs.find((n) => n.id === 'drain-factor');
  assert.ok(tally && tally.faction === 'tallymen', 'no tallyman at the table');
  assert.ok(factor && factor.faction === 'drain-toll', 'no factor in the Chute');
  assert.ok(npcsForDungeonFloor('temple', 0).some((n) => n.id === 'tallyman-ress'),
    'the tallyman never spawns at the bottom of the stairs');
  assert.ok(npcsForDungeonFloor('upper', 1).some((n) => n.id === 'drain-factor'),
    'the factor never spawns in the warrens');
});

/* --- THE REST OF THE POWERS: what standing with the four orders that were
 * written at depth but never meant anything actually buys. --- */

/* A monster placed in plain sight next to the company, asleep to it, on a
 * guaranteed-floor tile so the AI can act without tripping on its own wall. */
async function sightedMonster(g, p, id, dx, dy) {
  const { T } = await import('../public/js/mapgen.js');
  const t = {
    id, name: id, glyph: 'x', color: 'red', tier: 1, hpMax: 20, ac: 10,
    toHit: 0, damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1,
    goldMin: 0, goldMax: 0, props: [], speed: 1, aggroRange: 40,
  };
  const x = p.x + dx, y = p.y + dy;
  g.currentFloor.tiles[y][x] = T.FLOOR;
  return { t, x, y, hp: 20, maxhp: 20, boss: false, aggro: false, acted: false };
}

test('the Tallymen bend the rate for a friend of the table', () => {
  const { g } = rig('tallymen-rate');
  assert.equal(g.deathTollShare(), 0.5, 'a stranger is charged less than the standing rate');
  g.earnStanding('tallymen');
  const friend = g.deathTollShare();
  assert.ok(friend < 0.5, 'a friend of the table still pays full freight');
  assert.ok(friend >= 0.15, 'the rate reached nothing, and nothing is not a rate');
  g.earnStanding('tallymen', 3);
  assert.ok(g.deathTollShare() < friend, 'the rate did not bend further for a better friend');
  assert.ok(g.deathTollShare() >= 0.15, 'the rate bent past nothing');
});

test('the haul-back toll itself is what bends', () => {
  const { g } = rig('tallymen-toll');
  g.earnGold(1000);
  const before = g.purse();
  g.returnToCamp(true);
  assert.equal(before - g.purse(), Math.floor(before * 0.5), 'a stranger was not relieved of half');

  const { g: g2 } = rig('tallymen-toll');
  g2.earnGold(1000);
  g2.earnStanding('tallymen');
  const before2 = g2.purse();
  g2.returnToCamp(true);
  const toll2 = before2 - g2.purse();
  assert.equal(toll2, Math.floor(before2 * g2.deathTollShare()), 'the friend’s toll was not the friend’s rate');
  assert.ok(toll2 < Math.floor(before2 * 0.5), 'a friend of the table kept no more than a stranger');
});

test('the Drain Toll calls its crews off a customer, and only its crews', async () => {
  const { g, p } = rig('drain-truce');
  p.hp = 9999;
  g.vis = g.vis.map((row) => row.map(() => true));
  const rat = await sightedMonster(g, p, 'wererat', 2, 0);
  g.currentFloor.monsters.push(rat);
  /* A stranger is fair game on the toll road. */
  for (let t = 0; t < 3 && !rat.aggro; t++) { g.turn = t; g.resolveMonsters(); }
  assert.equal(rat.aggro, true, 'a wererat ignored a stranger in its road');
  /* But a customer is left alone. */
  rat.aggro = false; rat.ini = undefined;
  g.earnStanding('drain-toll');
  for (let t = 10; t < 14; t++) { g.turn = t; g.resolveMonsters(); }
  assert.equal(rat.aggro, false, 'the crews still charged a customer');
  /* The glowing rats are not theirs. */
  assert.equal(g.pacifiedToward({ t: { id: 'giant-rat' } }), null, 'a truce with the toll quieted the vermin');
});

test('the Standing Order knows its own once the arrears are closed', async () => {
  const { g, p } = rig('order-truce');
  p.hp = 9999;
  g.vis = g.vis.map((row) => row.map(() => true));
  const bones = await sightedMonster(g, p, 'skeleton', 2, 0);
  const statue = await sightedMonster(g, p, 'living-statue', -2, 0);
  const vermin = await sightedMonster(g, p, 'goblin', 0, 2);   /* not the garrison's, and not aquatic */
  g.currentFloor.monsters.push(bones, statue, vermin);
  assert.equal(g.pacifiedToward(bones), null, 'the garrison was friendly before the tithe');
  g.earnStanding('standing-order');
  for (let t = 0; t < 5; t++) { g.turn = t; g.resolveMonsters(); }
  assert.equal(bones.aggro, false, 'the marching bones still collected from a friend');
  assert.equal(statue.aggro, false, 'the walking statues still barred a friend');
  assert.equal(vermin.aggro, true, 'a truce with the garrison quieted a goblin');
});

test('the Archive names whatever a friend of the Library lifts', () => {
  const { g, p } = rig('weavers-off');
  const cold = deepItem(getItemTemplate('scroll-remove-curse'));
  cold.identified = false;
  g.pickupItem(cold, p);
  assert.equal(cold.identified, false, 'a stranger’s find named itself');

  const { g: g2, p: p2 } = rig('weavers-on');
  const warm = deepItem(getItemTemplate('scroll-remove-curse'));
  warm.identified = false;
  g2.earnStanding('lore-weavers');
  g2.pickupItem(warm, p2);
  assert.equal(warm.identified, true, 'the Archive did not read what was lifted');
});

/* --- THE FIRST ENTRY: the onboarding the game owes a stranger. --- */

test('the first entry is offered first, and the rite keeps it company', () => {
  const { g } = rig('tutorial');
  const offers = () => g.questsOnOffer('hermit-ogil').map((x) => x.id);
  assert.ok(offers().includes('the-first-entry'), 'the first entry was never offered');
  assert.equal(offers().includes('the-first-rite'), false, 'the rite came before the first entry');
  g.acceptQuest('the-first-entry');
  for (let i = 0; i < 3; i++) g.questKilled('rat');
  assert.ok(g.completeQuest('the-first-entry'), 'the first entry would not close');
  assert.ok(offers().includes('the-first-rite'), 'the rite never opened once the entry was made');
});

test('the loop is said out loud once, on the very first plunge', async () => {
  const { Game, initialStats } = await import('../public/js/engine.js');
  const calls = [];
  const g = new Game({ ui: { log: () => {}, showWelcome: () => calls.push('welcome') } });
  g.state.seed = 'welcome';
  g.foundAdventurer('Tester', 'fighter', initialStats('fighter'));
  assert.equal(calls.length, 1, 'the welcome was never shown on the first entry');
  assert.ok(g.state.player.counters.welcomeSeen, 'the welcome was not marked as said');
  g.enterDungeon('temple');
  assert.equal(calls.length, 1, 'the welcome was said again');
});

test('a nudge is said once and then gets out of the way', () => {
  const { g } = rig('nudge');
  g.tip('hurt', 'first warning');
  g.tip('hurt', 'second warning');
  assert.equal(g.logs.filter((l) => l === 'first warning').length, 1, 'the nudge was never said');
  assert.equal(g.logs.filter((l) => l === 'second warning').length, 0, 'the nudge repeated');
});

/* --- THE KEEPER OF THE ACCOUNT: the through line, said once. --- */

test('the Keeper has a word for each moment, and the last is the closing', async () => {
  const { keeperLine } = await import('../public/js/world.js');
  assert.ok(keeperLine('first-blood'), 'nothing for the first blood');
  assert.ok(keeperLine('fall'), 'nothing for the first loss');
  assert.ok(keeperLine('clear', 1) && keeperLine('clear', 2), 'no word for the first two sanctums');
  assert.ok(keeperLine('closing'), 'nothing for the closing');
  assert.equal(keeperLine('clear', 3), null, 'the third sanctum should close the book, not clear it');
});

test('the Keeper is heard once at each moment, and never twice', async () => {
  const { keeperLine } = await import('../public/js/world.js');
  const { g } = rig('keeper');
  g.speak('first-blood');
  g.speak('first-blood');
  assert.equal(g.logs.filter((l) => l === keeperLine('first-blood')).length, 1, 'the Keeper repeated himself');
  g.state.player.dungeonId = 'temple';
  g.onBossSlain({ t: { name: 'The Lapsai Demon' } });
  assert.equal(g.logs.filter((l) => l === keeperLine('clear', 1)).length, 1, 'the first sanctum drew no notice');
});

test('the drowned quarter has its own giver, and its own undertaking', () => {
  const { g } = rig('liss');
  assert.ok(g.questsOnOffer('liss').some((q) => q.id === 'the-sluices'), 'Liss has nothing to ask');
  const q = questById('the-sluices');
  g.acceptQuest(q.id);
  g.questKilled('tidewright');
  assert.ok(g.questSatisfied(q), 'the sluices will not close on the tidewright');
});

test('the townsfolk ask for things too', () => {
  const { g, p } = rig('town-quests');
  assert.ok(g.questsOnOffer('reach-salvager').some((q) => q.id === 'what-the-water-keeps'), 'Orrin asks nothing');
  assert.ok(g.questsOnOffer('reach-netmender').some((q) => q.id === 'what-comes-up-in-the-nets'), 'Essa asks nothing');
  assert.ok(g.questsOnOffer('maren').some((q) => q.id === 'aldous-still-down-there'), 'Maren asks nothing');
  /* A town quest is satisfied and paid like any other. */
  const q = questById('what-comes-up-in-the-nets');
  g.acceptQuest(q.id);
  for (let i = 0; i < 4; i++) g.questKilled('brine-hound');
  assert.ok(g.questSatisfied(q), 'Essa’s undertaking will not close on the hounds');
  const purse = g.purse();
  assert.ok(g.completeQuest(q.id), 'Essa’s undertaking would not be handed over');
  assert.equal(g.purse(), purse + q.reward.gold, 'Essa paid nothing');
  assert.ok(g.standing('drowned-sisters') > 0, 'the favour did not reach the Sisters');
  assert.ok(p.inventory.length >= 0);
});

/* --- RIVALRIES: earning with one order costs you with its rival. --- */

test('a favour to one order is a slight to its rival', () => {
  const { g } = rig('rivals');
  g.earnStanding('drain-toll', 3);
  assert.equal(g.standing('drain-toll'), 3);
  assert.equal(g.standing('drowned-sisters'), 0);
  /* A favour to the Sisters cools the toll by as much. */
  g.earnStanding('drowned-sisters', 2);
  assert.equal(g.standing('drowned-sisters'), 2);
  assert.equal(g.standing('drain-toll'), 1, 'the toll did not cool for the Sisters');
  /* And the other way. */
  g.earnStanding('drain-toll', 1);
  assert.equal(g.standing('drain-toll'), 2);
  assert.equal(g.standing('drowned-sisters'), 1, 'the Sisters did not cool for the toll');
  /* The Lore-Weavers keep no account of you, and so keep no quarrel. */
  assert.deepEqual(g.rivalsOf('lore-weavers'), []);
  assert.ok(g.rivalsOf('carriers-ubtao').includes('keepers-coils'), 'the families have no rival');
});

test('closing an undertaking cools the order behind its rival', () => {
  const { g } = rig('rival-quest');
  g.earnStanding('drain-toll', 3);
  /* Breaking the toll is Eilyth's, and files under the Drowned Sisters. */
  g.acceptQuest('the-toll-by-the-yard');
  for (let i = 0; i < 4; i++) g.questKilled('wererat');
  assert.ok(g.completeQuest('the-toll-by-the-yard'));
  assert.ok(g.standing('drowned-sisters') > 0, 'the Sisters were not credited');
  assert.ok(g.standing('drain-toll') < 3, 'the toll did not cool for work done against it');
});
