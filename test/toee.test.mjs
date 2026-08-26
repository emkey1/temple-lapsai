/* THE TOEE TURN: movement and a blow, attacks of opportunity, flanking.
 *
 * In combat a member's turn is ground up to their speed plus one standard
 * action, in the order they choose; the round advances only when the turn
 * is spent. Leaving a threatened square provokes one free blow per creature
 * per round — with the 3.5 mercy that one step, and no more, is free.
 * Flanking is +2 for anyone with an ally roughly opposite. All of it is
 * pinned here headless, because this is the phase where the game stops
 * being a bump-fest and starts being a battle map. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { T, W, H } from '../public/js/mapgen.js';
import { newGame } from './helpers.mjs';

/* An open arena with the walls far away, so nothing here is about corridors. */
function arena(g) {
  const tiles = Array.from({ length: H }, () => Array(W).fill(T.WALL));
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) tiles[y][x] = T.FLOOR;
  g.currentFloor = {
    w: W, h: H, tiles, rooms: [], monsters: [], items: [], npcs: [],
    up: { x: 3, y: 3 }, down: null, isLast: false, den: null,
  };
  g.seen = Array.from({ length: H }, () => Array(W).fill(true));
  g.vis = Array.from({ length: H }, () => Array(W).fill(true));
  const p = g.state.player;
  p.x = 10; p.y = 10;
  return g.currentFloor;
}

function beast(x, y, over = {}) {
  return {
    t: {
      id: over.id || 'test-beast', name: over.name || 'Test Beast', glyph: 'b', color: 'green',
      hpMax: over.hp || 60, ac: over.ac ?? 10, toHit: over.toHit ?? 0,
      damage: { dice: 1, sides: 2, bonus: 0 }, xp: 1, goldMin: 0, goldMax: 0,
      props: [], speed: over.speed || 1, aggroRange: 20,
    },
    x, y, hp: over.hp || 60, maxhp: over.hp || 60, boss: false, aggro: true,
    toHit: over.toHit ?? 0, dmg: { dice: 1, sides: 2, bonus: 0 },
    xp: 1, goldMin: 0, goldMax: 0, ini: over.ini ?? 1,
  };
}

/* Deal the reins to the tester and count what the monsters get to do. */
function begin(g) {
  g.state.player.ini = 30;
  g._round = null;
  let acts = 0;
  const real = g.monsterTakeTurn.bind(g);
  g.monsterTakeTurn = (m, f) => { if (m.hp > 0) acts++; real(m, f); };
  g.advanceQueue();
  return () => acts;
}

test('a step in combat holds the turn: the round does not advance', () => {
  const g = newGame('t3-hold');
  const f = arena(g);
  f.monsters.push(beast(16, 10));
  const acts = begin(g);
  g.handleKey('d');
  assert.equal(acts(), 0, 'one step spent the whole turn');
  assert.equal(g.actorTurn(g.state.player).moved, 1);
  assert.equal(g.state.player.x, 11, 'the step did not land');
});

test('the budget spends itself when nothing stands in reach', () => {
  const g = newGame('t3-budget');
  const f = arena(g);
  f.monsters.push(beast(20, 10));    /* far enough that three steps end short */
  const acts = begin(g);
  g.handleKey('d');
  g.handleKey('d');
  assert.equal(acts(), 0);
  g.handleKey('d');                  /* a fighter's third step: budget gone, nothing adjacent */
  assert.equal(acts(), 1, 'the turn should spend itself at full stretch');
});

test('a full advance ends in a swing, not a shrug', () => {
  const g = newGame('t3-advance');
  const f = arena(g);
  const mo = beast(14, 10, { ac: 30 });   /* descending AC: high is a barn door */
  f.monsters.push(mo);
  const acts = begin(g);
  g.handleKey('d'); g.handleKey('d'); g.handleKey('d');   /* three steps: now adjacent */
  assert.equal(acts(), 0, 'the turn spent itself with a monster in reach');
  const hpBefore = mo.hp;
  g.handleKey('d');                                       /* the blow */
  assert.equal(acts(), 1, 'the strike should end the turn');
  assert.ok(mo.hp < hpBefore, 'the strike did not land on a barn door');
});

test('waiting spends the turn whole', () => {
  const g = newGame('t3-wait');
  const f = arena(g);
  f.monsters.push(beast(16, 10));
  const acts = begin(g);
  g.handleKey('d');
  g.handleKey(' ');
  assert.equal(acts(), 1, 'space should surrender the rest of the turn');
});

test('one careful step is free; the second calls the debt in', () => {
  const g = newGame('t3-shift');
  const f = arena(g);
  f.monsters.push(beast(11, 10, { toHit: 40 }));   /* adjacent, and cannot miss */
  const acts = begin(g);
  const hp0 = g.state.player.hp;
  g.handleKey('a');   /* step away: the shift, provisionally free */
  assert.equal(g.state.player.hp, hp0, 'the shift itself drew blood');
  g.handleKey('a');   /* the second step: the debt comes due */
  assert.ok(g.state.player.hp < hp0, 'walking off never provoked');
  assert.match(g.logs.join(' '), /seizes the opening/i);
  assert.equal(acts(), 0, 'the provoked blow is free — it is not the monster\'s turn');
});

test('an opening is one blow per creature per round', () => {
  const g = newGame('t3-once');
  const f = arena(g);
  f.monsters.push(beast(11, 10, { toHit: 40 }));
  begin(g);
  g.handleKey('a'); g.handleKey('a');
  const seizures = g.logs.filter((l) => /seizes the opening/i.test(l)).length;
  assert.equal(seizures, 1, 'the same creature collected twice in one round');
});

test('a monster stepping out of reach is struck at in turn', () => {
  const g = newGame('t3-mono');
  const f = arena(g);
  /* Fleeing and fast: it will turn tail and cross the party's reach. */
  const mo = beast(11, 10, { speed: 3, hp: 200 });
  mo.fleeing = true;
  f.monsters.push(mo);
  g.state.player.ini = 30;
  g._round = null;
  g.advanceQueue();
  g.handleKey(' ');   /* wait; the beast's turn comes, and it runs */
  assert.match(g.logs.join(' '), /seize.? the opening as the Test Beast turns/i,
    'no member collected on the retreat');
});

test('flanking is the geometry it claims: opposites yes, shoulders no', () => {
  const g = newGame('t3-flank');
  const target = { x: 10, y: 10, hp: 10 };
  const attacker = { x: 9, y: 10, hp: 10 };
  assert.equal(g.flankBonus(attacker, target, [{ x: 11, y: 10, hp: 10 }]), 2, 'the true opposite');
  assert.equal(g.flankBonus(attacker, target, [{ x: 11, y: 11, hp: 10 }]), 2, 'the near-opposite diagonal');
  assert.equal(g.flankBonus(attacker, target, [{ x: 9, y: 11, hp: 10 }]), 0, 'a shoulder is not a pincer');
  assert.equal(g.flankBonus(attacker, target, [{ x: 13, y: 10, hp: 10 }]), 0, 'an ally across the room');
  assert.equal(g.flankBonus(attacker, target, [{ x: 11, y: 10, hp: 0 }]), 0, 'the dead do not flank');
  assert.equal(g.flankBonus(attacker, target, [attacker]), 0, 'you cannot flank with yourself');
});

test('out of combat, one keypress is still one round for everybody', () => {
  const g = newGame('t3-calm');
  arena(g);   /* no monsters at all */
  const turn0 = g.turn;
  g.handleKey('d');
  assert.ok(g.turn > turn0, 'a calm step no longer advances the round');
  assert.equal(g.actorTurn(g.state.player).moved || 0, 0, 'combat bookkeeping leaked into the calm');
});

test('the class speeds are the promised ground', () => {
  for (const [cls, speed] of [['fighter', 3], ['thief', 5], ['mage', 4], ['cleric', 3]]) {
    const g = newGame('t3-speed-' + cls, cls);
    assert.equal(g.memberSpeed(g.state.player), speed, cls);
  }
});

/* ---- the company's dues: healing and loot stop being welded to the
 * active member, which betrayed the game's single-character origins the
 * moment there was anyone else to save or to carry. ---- */

import { makePlayer, initialStats as stats2 } from '../public/js/engine.js';

function companion(g, cls, name) {
  const b = makePlayer(name, cls, stats2(cls));
  const p = g.state.player;
  b.dungeonId = p.dungeonId; b.floorIdx = p.floorIdx;
  b.x = p.x + 1; b.y = p.y;
  g.state.party.members.push(b);
  return b;
}

test('a healing touch falls on the worst-hurt in reach, not the caster', () => {
  const g = newGame('t3-heal', 'cleric');
  arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'fighter', 'Hurt');
  p.hp = p.maxhp - 1;                          /* scratched */
  buddy.hp = Math.floor(buddy.maxhp / 4);      /* bleeding out beside you */
  g.activateAbility('lay-hands');
  assert.ok(buddy.hp > Math.floor(buddy.maxhp / 4), 'the cleric healed nobody but themselves');
});

test('a healing touch does not reach across the room', () => {
  const g = newGame('t3-heal-far', 'cleric');
  arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'fighter', 'Far');
  buddy.x = p.x + 6;
  buddy.hp = 1;
  p.hp = p.maxhp - 2;
  g.activateAbility('lay-hands');
  /* Calm regen may tick a point as the turn passes; a real 2d6 heal cannot
   * be mistaken for it. */
  assert.ok(buddy.hp <= 3, 'Lay on Hands is a touch, not a volley');
  assert.ok(p.hp > p.maxhp - 2, 'with nobody in reach the touch falls on the caster');
});

test('second wind is the fighter\'s own breath', () => {
  const g = newGame('t3-wind', 'fighter');
  arena(g);
  const p = g.state.player;
  for (let i = 1; i < 6; i++) g.levelUp(p);
  p.power = 99; p.maxpower = 99;
  const buddy = companion(g, 'cleric', 'Worse');
  buddy.hp = 1;
  p.hp = Math.floor(p.maxhp / 2);
  g.activateAbility('second-wind');
  assert.ok(buddy.hp <= 3, 'selfOnly leaked onto a companion');
  assert.ok(p.hp > Math.floor(p.maxhp / 2), 'the fighter did not catch their own breath');
});

test('G sends the loot to the pack in focus', () => {
  const g = newGame('t3-loot');
  arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'thief', 'Packrat');
  g.currentFloor.items.push({ x: p.x, y: p.y, i: { id: 'x', name: 'A Trinket', kind: 'misc', value: 1 } });
  g.handleKey('g', { lootTo: 1 });
  assert.ok(buddy.inventory.some((it) => it.name === 'A Trinket'), 'the trinket missed the focused pack');
  assert.ok(!p.inventory.some((it) => it.name === 'A Trinket'), 'the taker kept it anyway');
});

test('mid-fight, a pack across the room is out of reach', () => {
  const g = newGame('t3-loot-far');
  const f = arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'thief', 'Away');
  buddy.x = p.x + 7;
  f.monsters.push(beast(p.x + 3, p.y));   /* something awake and close: combat */
  g.currentFloor.items.push({ x: p.x, y: p.y, i: { id: 'x', name: 'A Coin Purse', kind: 'misc', value: 1 } });
  g.handleKey('g', { lootTo: 1 });
  assert.ok(p.inventory.some((it) => it.name === 'A Coin Purse'), 'the loot vanished');
  assert.ok(!buddy.inventory.length, 'the purse teleported across a fight');
});

/* ---- ten-foot corridors, and the shadow ---- */

import { generateFloor, W as MW, H as MH, isTravelable as mtrav } from '../public/js/mapgen.js';
import { getDungeon as getDungeon2 } from '../public/js/base.js';

test('corridors are wide enough to fight beside a friend', () => {
  /* The old carve made single-file queues of every fight. Now nearly every
   * walkable tile has an orthogonal walkable partner — room for two. */
  for (const seed of ['wide-a', 'wide-b']) {
    const f = generateFloor({ dungeon: getDungeon2('temple'), floorIdx: 1, seed: seed.length * 7919 + seed.charCodeAt(5) });
    let open = 0, partnered = 0;
    for (let y = 1; y < MH - 1; y++) {
      for (let x = 1; x < MW - 1; x++) {
        if (!mtrav(f.tiles[y][x])) continue;
        open++;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => mtrav(f.tiles[y + dy][x + dx]))) partnered++;
      }
    }
    assert.ok(partnered / open > 0.97, 'single-file ground remains: ' + (partnered / open).toFixed(3));
  }
});

test('a hidden thief is not there, until the knife is', () => {
  const g = newGame('shadow-1', 'thief');
  const f = arena(g);
  g.levelUp(g.state.player);   /* level 2: the art is learned */
  const p = g.state.player;
  p.power = 20;
  const mo = beast(p.x + 1, p.y, { ac: 30, hp: 200, toHit: 40 });
  f.monsters.push(mo);
  g.state.player.ini = 30;
  g._round = null; g.advanceQueue();
  g.activateAbility('hide-shadows');
  assert.ok(p.buffs.shadow > 0, 'the shadow did not take');
  assert.equal(g.targetableMembers().length, 0, 'hidden, yet still hunted');
  const hpBefore = p.hp;
  g.handleKey(' ', {});   /* let the beast's turn pass: it cannot find you */
  assert.equal(p.hp, hpBefore, 'a blow landed on someone who is not there');

  const monHp = mo.hp;
  g.tryMove(1, 0);         /* the knife */
  assert.ok(!(p.buffs.shadow > 0), 'the strike should end the hiding');
  assert.ok(mo.hp < monHp, 'the blow from the dark missed a barn door');
  assert.ok(monHp - mo.hp >= 2, 'no depth to the shadow blow');
});

test('a hidden member lets the opening pass rather than spend the shadow', () => {
  const g = newGame('shadow-2', 'thief');
  arena(g);
  const p = g.state.player;
  p.buffs.shadow = 5;
  const mo = { t: { id: 'x', name: 'X', ac: 30, hpMax: 20 }, x: p.x + 1, y: p.y, hp: 20 };
  g.memberOpportunity(p, mo);
  assert.equal(mo.hp, 20, 'the reflex swing spent the shadow');
  assert.ok(p.buffs.shadow > 0, 'the shadow broke on a swing that never happened');
});

/* ---- the bill for a fatal step ----
 *
 * Reported: "after the first turn that combat starts, movement no longer
 * resets on the next turn... spells can't be cast and skills can't be used
 * unless the character moves first." The trigger was a member falling to an
 * opportunity blow on their own step: memberDown handed the reins to a
 * companion inside the same keystroke, and endPlayerTurn billed the dead
 * member's move to the living one — whose ground then never reset, while
 * the stalled round stopped ticking cooldowns and power with it. */
test('a member who falls to the opening does not bill the turn to the next in line', () => {
  const g = newGame('t3-fatal-bill');
  const f = arena(g);
  const a = g.state.player;                       /* the one who inherits the reins */
  const doomed = companion(g, 'mage', 'Doomed');  /* at a.x+1 — beside the beast */
  doomed.hp = 1;
  /* Out of the line's reach: when calm breaks, an adjacent van member now
   * trades places with a rear member standing nearer the foe — which is
   * exactly the doom this scenario needs to keep. Two tiles back, the
   * fighter cannot shoulder in, and the mage keeps her appointment. */
  a.x = doomed.x - 2;
  f.monsters.push(beast(doomed.x + 1, doomed.y, { toHit: 100 }));  /* every blow lands */
  a.ini = 20; doomed.ini = 30;
  g._round = null;
  g.advanceQueue();
  assert.equal(g.state.player, doomed, 'the doomed mage should hold the reins first');

  g.handleKey('w');   /* step one: the free shift */
  g.handleKey('w');   /* step two calls in the debt — and the blow kills */
  assert.equal(doomed.hp, 0, 'the opening should have been fatal');
  assert.equal(g.state.player, a, 'the reins should pass to the survivor');
  const at = g.actorTurn(a);
  assert.ok(!at.moved, `the dead member's ground was billed to the survivor (moved ${at.moved})`);
  assert.ok(!at.acted, 'the survivor was marked as having acted before acting');

  /* And the round still turns: waiting spends the turn, the beast moves,
   * the round ends, and the next one opens with fresh ground. */
  const before = g.turn;
  g.handleKey('x');
  assert.ok(g.turn > before, 'the round queue stalled after the fall');
  assert.ok(!g.actorTurn(a).moved && !g.actorTurn(a).acted, 'the new round did not reset the turn');
});

test('a blade in reach is in reach on the diagonal too', () => {
  /* Backstab refused a foe on the diagonal that a plain strike would take:
   * ability range was measured in Manhattan, where the corner is two away,
   * while every other law of reach — strikes, openings, flanks — plays in
   * king moves. Shield Bash suffered the same. */
  for (const [cls, id] of [['thief', 'backstab'], ['fighter', 'shield-bash']]) {
    const g = newGame('diag-' + id, cls);
    const f = arena(g);
    const p = g.state.player;
    p.level = 3; p.power = 20;
    const mo = beast(p.x + 1, p.y + 1, { ac: 30 });   /* the corner foe, a barn door */
    f.monsters.push(mo);
    g.activateAbility(id);
    assert.ok(mo.hp < mo.maxhp, id + ' found no target on the diagonal');
  }
});

/* ---- the marching order ----
 *
 * "If the main character is a mage, he tends to end up in the front when
 * combat starts." Out of combat the company holds a formation now: the VAN
 * marches ahead of whoever holds the reins, the REAR behind. Class sets
 * the default — steel forward, robes back — and the sheet overrides it. */
test('the van marches ahead of the reins, the rear behind', () => {
  const g = newGame('t3-march', 'mage');
  arena(g);
  const p = g.state.player;
  const van = companion(g, 'fighter', 'Shield');
  const rear = companion(g, 'cleric', 'Voice');
  van.x = p.x - 1; van.y = p.y;
  rear.x = p.x - 2; rear.y = p.y;
  for (let i = 0; i < 8; i++) g.handleKey('d');
  assert.ok(van.x >= p.x, `the fighter marches at x=${van.x}, behind the mage at x=${p.x}`);
  assert.ok(rear.x <= p.x, `the cleric marches at x=${rear.x}, ahead of the mage at x=${p.x}`);
  assert.ok(van.x > rear.x, 'the van does not lead the rear');
});

test('the sheet overrides the class stance', () => {
  const g = newGame('t3-march-override', 'mage');
  arena(g);
  const p = g.state.player;
  const guard = companion(g, 'fighter', 'Wary');
  guard.x = p.x - 1; guard.y = p.y;
  guard.stance = 'rear';   /* the sheet's toggle writes exactly this */
  for (let i = 0; i < 8; i++) g.handleKey('d');
  assert.ok(guard.x <= p.x, 'a fighter ordered to the rear marched to the van anyway');
});

/* ---- the refused-draught law, for powers ----
 *
 * "Using a skill when it can't work should not put it on cooldown." A
 * working with nothing to work on now costs neither power, cooldown nor
 * the turn — blowing the backstab because the round was on the wrong
 * member was a tax on misreading a marker. */
test('a working with nothing to work on costs nothing', () => {
  const g = newGame('t3-held-working', 'thief');
  arena(g);   /* not a monster in sight */
  const p = g.state.player;
  p.level = 3; p.power = 10;
  const turnBefore = g.turn;
  g.activateAbility('backstab');
  assert.equal(p.power, 10, 'power was spent on an empty room');
  assert.ok(!(p.cooldowns.backstab > 0), 'the cooldown started on an empty room');
  assert.equal(g.turn, turnBefore, 'the turn was spent on an empty room');
});

test('a healing touch on a whole company is held, not spent', () => {
  const g = newGame('t3-held-heal', 'cleric');
  arena(g);
  const p = g.state.player;
  p.level = 3; p.power = 10;
  g.activateAbility('lay-hands');
  assert.equal(p.power, 10, 'power spent healing nobody');
});

test('the working still fires when there is something to work on', () => {
  const g = newGame('t3-held-fires', 'thief');
  const f = arena(g);
  const p = g.state.player;
  p.level = 3; p.power = 10;
  f.monsters.push(beast(p.x + 1, p.y + 1, { ac: 30 }));   /* on the diagonal, even */
  g.activateAbility('backstab');
  assert.ok(p.power < 10, 'the refusal law refused a working with a target');
});

/* ---- brushing past a companion ----
 *
 * "You trade places with..." displaced whoever you brushed: mid-fight it
 * could hand a mage the exact square the fighter was holding, and on the
 * march it churned the column. Three answers now: PASS when there is room
 * beyond (they never move), SHOVE when there is not (they give ground away
 * from the fight), SWAP only when nowhere else will have them. */
test('you slip past a companion when there is room beyond', () => {
  const g = newGame('t3-pass', 'thief');
  const f = arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'fighter', 'Wall');
  f.monsters.push(beast(p.x + 8, p.y, {}));   /* combat is on, but far */
  begin(g);
  const bx = buddy.x, by = buddy.y;
  g.handleKey('d');
  assert.equal(p.x, bx + 1, 'the mover should land beyond the companion');
  assert.ok(buddy.x === bx && buddy.y === by, 'a passing displaced the companion');
  assert.equal(g.actorTurn(p).moved, 2, 'two tiles of ground should cost two');
});

test('a companion gives ground away from the fight, not into it', () => {
  const g = newGame('t3-shove', 'fighter');
  const f = arena(g);
  const p = g.state.player;                     /* 10,10 */
  const buddy = companion(g, 'mage', 'Soft');   /* 11,10 */
  f.tiles[10][12] = T.WALL;                     /* no room beyond: no pass */
  const mo = beast(9, 10, {});                  /* the fight is BEHIND the mover */
  f.monsters.push(mo);
  begin(g);
  g.handleKey('d');
  assert.equal(p.x, 11, 'the mover should take the square');
  assert.ok(!(buddy.x === 10 && buddy.y === 10), 'the shove fell back to a swap toward the fight');
  const clear = Math.max(Math.abs(mo.x - buddy.x), Math.abs(mo.y - buddy.y));
  assert.ok(clear >= 3, 'the mage was pushed toward the monster (' + clear + ' away)');
});

test('the swap survives where there is nowhere to give ground', () => {
  const g = newGame('t3-swap-last', 'fighter');
  const f = arena(g);
  const p = g.state.player;                     /* 10,10 */
  const buddy = companion(g, 'mage', 'Cornered');   /* 11,10 */
  /* wall the pocket: every neighbour of the mage except the mover's square */
  for (const [wx, wy] of [[12, 10], [12, 9], [12, 11], [11, 9], [11, 11], [10, 9], [10, 11]]) {
    f.tiles[wy][wx] = T.WALL;
  }
  f.monsters.push(beast(8, 10, {}));
  begin(g);
  g.handleKey('d');
  assert.equal(p.x, 11, 'the mover should take the square');
  assert.ok(buddy.x === 10 && buddy.y === 10, 'the cornered companion should land in the trade');
});

test('the march does not narrate the column flowing through itself', () => {
  const g = newGame('t3-quiet-march', 'thief');
  arena(g);   /* nothing awake anywhere */
  const p = g.state.player;
  const buddy = companion(g, 'fighter', 'Point');
  for (let i = 0; i < 6; i++) g.handleKey('d');
  const chatter = g.logs.filter((l) => /trade places|slip past|gives ground/.test(l));
  assert.equal(chatter.length, 0, 'the march narrated itself: ' + chatter[0]);
});

/* ---- the standing cast ----
 *
 * "The non primary character can't use skills outside of combat." True, and
 * indefensible: between fights the reins never leave the leader, so a
 * companion cleric could not so much as say a prayer. Any living member now
 * works their powers between fights — the company stands still, the round
 * passes, and the reins go back where they were. Mid-fight the initiative
 * order still decides. */
test('a companion works a power between fights, and the company stands still', () => {
  const g = newGame('t3-standing-cast', 'fighter');
  arena(g);
  const p = g.state.player;
  const voice = companion(g, 'cleric', 'Voice');
  voice.power = 20;
  p.hp = Math.floor(p.maxhp / 2);
  const spots = g.state.party.members.map((m) => [m.x, m.y]);
  const reins = g.state.party.active;
  assert.ok(g.castAs(voice, 'lay-hands'), 'the standing cast was refused in calm halls');
  assert.ok(p.hp > Math.floor(p.maxhp / 2), 'the standing cast healed nobody');
  assert.ok(voice.power < 20, 'the caster paid nothing');
  assert.equal(g.state.party.active, reins, 'the cast stole the reins');
  g.state.party.members.forEach((m, i) => {
    assert.deepEqual([m.x, m.y], spots[i], m.name + ' moved during a standing cast');
  });
});

test('mid-fight the standing cast defers to the round', () => {
  const g = newGame('t3-standing-fight', 'fighter');
  const f = arena(g);
  const p = g.state.player;
  const voice = companion(g, 'cleric', 'Voice');
  voice.power = 20;
  p.hp = Math.floor(p.maxhp / 2);
  f.monsters.push(beast(p.x + 2, p.y, {}));
  begin(g);   /* the fighter holds the reins, mid-round */
  assert.equal(g.castAs(voice, 'lay-hands'), false, 'a companion cast out of turn mid-fight');
  assert.equal(voice.power, 20, 'the refused cast still charged power');
});

/* ---- the tile worth standing on ----
 *
 * Reported twice in one evening: the gem in the demon's lair "vibrated the
 * screen" instead of being picked up, and the stairs off the fourth floor
 * "did not work" — both because a companion stood on the tile and the slip
 * carried the mover PAST the very thing they were stepping onto, while the
 * walker re-routed back through them forever. Landing beats passing where
 * the ground itself matters, and the landing steps on what it lands on. */
test('you land on what is worth standing on, not past it', () => {
  const g = newGame('t3-worth', 'fighter');
  const f = arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'mage', 'Idle');   /* at p.x+1 */
  f.items.push({ x: buddy.x, y: buddy.y, i: { name: 'Gemstone', kind: 'treasure', value: 40 } });
  const bx = buddy.x;
  g.tryMove(1, 0);
  assert.equal(p.x, bx, 'the mover slipped past the gem instead of landing on it');
  assert.ok(g.logs.some((l) => /Underfoot: Gemstone/.test(l)), 'the landing never noticed the gem');
});

test('a slip past a companion follows the route, not the compass', () => {
  const g = newGame('t3-exit', 'fighter');
  arena(g);
  const p = g.state.player;
  const buddy = companion(g, 'mage', 'Door');   /* at p.x+1 — the corner tile */
  const bx = buddy.x, by = buddy.y;
  /* The route turns south at the companion's tile: the exit says so. */
  g.tryMove(1, 0, { dx: 0, dy: 1 });
  assert.deepEqual([p.x, p.y], [bx, by + 1], 'the slip ejected straight instead of along the route');
  assert.deepEqual([buddy.x, buddy.y], [bx, by], 'the companion was displaced by a routed slip');
});

test('the stairs work with a friend standing on them', () => {
  const g = newGame('t3-stair-friend', 'fighter');
  g.loadFloor(1);   /* a real temple floor, with a real up-staircase */
  g.currentFloor.monsters.length = 0;
  const p = g.state.player;
  const up = g.currentFloor.up;
  const buddy = companion(g, 'thief', 'Perch');
  buddy.x = up.x; buddy.y = up.y;          /* the van, on the stairs */
  p.x = up.x + 1; p.y = up.y;
  g.computeVisibility();
  g.tryMove(-1, 0);
  assert.equal(p.floorIdx, 0, 'the stairs did not work with a friend on them');
});

import { getItemTemplate as tpl2 } from '../public/js/base.js';
import { deepItem as deep2 } from '../public/js/dice.js';
const makeItem2 = (id) => deep2(tpl2(id));

test('a companion reads a scroll between fights — the standing swig', () => {
  const g = newGame('t3-standing-swig', 'fighter');
  arena(g);
  const p = g.state.player;
  const reader = companion(g, 'thief', 'Reader');
  /* an unread blade in the LEADER's pack; the scroll in the COMPANION's */
  const blade = makeItem2('short-sword');
  blade.identified = false; blade.trueName = '+1 Short Sword';
  p.inventory.push(blade);
  const scroll = makeItem2('scroll-identify');
  reader.inventory.push(scroll);
  const reins = g.state.party.active;
  assert.ok(g.useItemAs(reader, scroll), 'the standing swig was refused in calm halls');
  assert.equal(blade.identified, true, 'the companion’s reading identified nothing');
  assert.ok(!reader.inventory.includes(scroll), 'the scroll survived its own reading');
  assert.equal(g.state.party.active, reins, 'the reading stole the reins');
});

test('mid-fight the standing swig defers to the round', () => {
  const g = newGame('t3-swig-fight', 'fighter');
  const f = arena(g);
  const p = g.state.player;
  const reader = companion(g, 'thief', 'Reader');
  const scroll = makeItem2('scroll-identify');
  reader.inventory.push(scroll);
  f.monsters.push(beast(p.x + 2, p.y, {}));
  begin(g);
  assert.equal(g.useItemAs(reader, scroll), false, 'a companion drank out of turn mid-fight');
  assert.ok(reader.inventory.includes(scroll), 'the refused reading still spent the scroll');
});
