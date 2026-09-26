/* THE SIMULATOR — a robot delver.
 *
 * The tests check invariants one call at a time; this plays whole runs, start to
 * finish, with a policy that does the obvious competent things (fight what is
 * beside you, take what is under you, rest when you are hurt, go down when the
 * floor is done, come up to town when your pack is full or your bones are) and
 * is bad at all of it on purpose, because the point is not to win — it is to
 * walk the game as a player would and catch what falls out.
 *
 * It is headless: the engine has no DOM, so a whole run is a few thousand calls
 * with a log sink attached. Output is two things — a BALANCE report (how deep,
 * how high a level, how rich, how often dead) and a BUG report (any exception,
 * with the seed that reproduces it).
 *
 *   node scripts/simulate.mjs                 # 24 runs, one per class, seeded
 *   node scripts/simulate.mjs --runs 200       # a bigger sample
 *   node scripts/simulate.mjs --seed hello --verbose
 */

import { Game, initialStats, PACK_LIMIT } from '../public/js/engine.js';
import { abilitiesFor, getItemTemplate } from '../public/js/base.js';
import { T, W, H, isTravelable } from '../public/js/mapgen.js';
import { shopStock, buyItem, sellItem, takeRoom, hireMember, hireCost, raiseMember, fallenMembers } from '../public/js/town.js';

/* ---- the rig ---- */

function makeGame(seed, clsId) {
  const logs = [];
  const ui = {
    log: (m) => logs.push(String(m)),
    render() {}, refreshHud() {}, setLocation() {}, showArrival() {}, showBeat() {},
    showFloor() {}, showVictory() {}, showCamp() {}, unlock() {}, prepareTransition() {},
    openDialogue() {}, recordAccount() {}, showWelcome() {},
  };
  const g = new Game({ ui });
  g.state.seed = seed;
  g.foundAdventurer('Bot', clsId, initialStats(clsId));
  g.logs = logs;
  return g;
}

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function hostiles(g) {
  const floor = g.currentFloor;
  return ((floor && floor.monsters) || []).filter((m) => m.hp > 0 && !m.submerged);
}

/* The first step of a shortest path from `start` to any tile a predicate likes.
 * Paths treat closed doors as passable (a bump opens them) and secret doors as
 * wall (a search is a separate act). */
function firstStepTo(floor, start, pred) {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  /* Ground, a door to open, or a hidden seam — bumping a secret searches it,
   * which is how a player uses a map: the route can run through a wall you
   * have to find, so the bot walks at the wall instead of staring at one. */
  const ok = (t) => isTravelable(t) || t === T.DOOR_C || t === T.SECRET;
  const startK = start.y * W + start.x;
  const prev = new Map([[startK, null]]);
  const q = [start];
  let goal = null;
  for (let i = 0; i < q.length && !goal; i++) {
    const c = q[i];
    if (!(c.x === start.x && c.y === start.y) && pred(c.x, c.y, floor.tiles[c.y][c.x]) && ok(floor.tiles[c.y][c.x])) { goal = c; break; }
    for (const [dx, dy] of DIRS) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const k = y * W + x;
      if (prev.has(k)) continue;
      const t = floor.tiles[y][x];
      if (!ok(t)) continue;   /* never path through stone; a goal on stone is unreachable */
      /* A person blocks the way: walking into one opens a conversation, not a
       * step. Route around them. */
      if (!pred(x, y, t) && (floor.npcs || []).some((n) => n.x === x && n.y === y)) continue;
      prev.set(k, c.y * W + c.x);
      q.push({ x, y });
    }
  }
  if (!goal) return null;
  let cur = goal.y * W + goal.x;
  let guard = W * H;
  while (prev.get(cur) !== startK && prev.get(cur) !== null && guard-- > 0) cur = prev.get(cur);
  if (prev.get(cur) !== startK) return null;
  return { dx: (cur % W) - start.x, dy: Math.floor(cur / W) - start.y };
}

/* The first step of a route AND the step after it. The engine's ally PASS
 * ejects straight ahead two tiles; at a corner that overshoots the turn and
 * the walker ping-pongs. Handing it the route's continuation fixes that. */
function routeMove(floor, p, pred) {
  const s = firstStepTo(floor, p, pred);
  if (!s) return null;
  const mid = { x: p.x + s.dx, y: p.y + s.dy };
  const s2 = firstStepTo(floor, mid, pred);
  return { dx: s.dx, dy: s.dy, exitDx: s2 ? s2.dx : 0, exitDy: s2 ? s2.dy : 0 };
}

function searchABit(g) {
  const p = g.state.player, floor = g.currentFloor;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = p.x + dx, y = p.y + dy;
    const t = floor.tiles[y] && floor.tiles[y][x];
    if (t === T.WALL || t === T.SECRET) { g.searchSecretAt(x, y); return true; }
  }
  return false;
}

/* A goal is valid while it still exists: a monster alive, an item where it was,
 * a stair always. */
function goalValid(g, goal) {
  if (!goal) return false;
  if (goal.kind === 'monster') return !!(goal.m && goal.m.hp > 0 && !goal.m.submerged);
  if (goal.kind === 'item') return ((g.currentFloor.items) || []).some((it) => it.x === goal.x && it.y === goal.y);
  return true;   /* a stair is always there */
}
function goalPos(goal) {
  return goal.kind === 'monster' ? { x: goal.m.x, y: goal.m.y } : { x: goal.x, y: goal.y };
}
/* A goal's name, for a short memory of the ones that could not be reached. */
function goalKey(c) {
  return c.kind === 'monster' ? 'm:' + (c.m.id || '?') : c.kind + ':' + c.x + ',' + c.y;
}
/* Keep the staleness clock only for a genuinely new goal, so re-approaching an
 * old one does not reset it to zero forever. */
function setGoal(st, c) {
  if (!st.goal || goalKey(st.goal) !== goalKey(c)) { st.goal = c; st.goalSince = st.turn; }
}
/* Step onto a stair tile; up means town (eventually), down means deeper. */
function climbOrDescend(g, x, y) {
  const floor = g.currentFloor;
  g.stepOn(x, y);
  return (floor.up && x === floor.up.x && y === floor.up.y) ? 'climb' : 'descend';
}

/* A dungeon turn. Returns a short label for the metric of what it did. */
function dungeonTurn(g, st) {
  const p = g.state.player, floor = g.currentFloor;

  /* A breaker, when the loop notices nothing has changed for a while: one
   * deliberate step in a turning direction, so a chase or a stare-off has to
   * become a different position and a different choice. */
  if (st.force) { st.force = false; if (!st.wantsTown) return nudge(g, st); }

  st.turn = (st.turn || 0) + 1;
  st.avoid = st.avoid || new Set();

  /* 0. Hurt, or carrying too much to fight well: go home. This wins over the
   *    fight, so the bot stops trading blows it is going to lose — drink on the
   *    run, climb the stairs floor by floor until the town. A dead delver's
   *    balance numbers mean nothing. */
  /* On the boss floor the boss is whole again the moment you climb back down,
   * so a retreat mid-fight is not a breather — it is a reset. Commit: only the
   * last sliver of health sends the company home from the last floor. */
  const bossHere = !!(floor.isLast && hostiles(g).some((m) => m.boss));
  const hurt = p.hp < p.maxhp * (bossHere ? 0.12 : 0.28);
  const laden = p.inventory.length >= PACK_LIMIT - 1 && !bossHere;
  if (hurt || laden) st.wantsTown = true;
  if (st.wantsTown) {
    /* A retreat that never finds the way home is a loop, not caution. Give it a
     * long leash, then press on. */
    st.retreat = (st.retreat || 0) + 1;
    if (st.retreat > 250) { st.wantsTown = false; st.retreat = 0; }
  }
  if (st.wantsTown) {
    if (p.hp < p.maxhp * (bossHere ? 0.5 : 0.24) && potion(g)) return 'drink';
    const up = floor.up;
    if (up && p.x === up.x && p.y === up.y) { g.stepOn(up.x, up.y); return 'climb'; }
    if (up) {
      const step = routeMove(floor, p, (x, y) => x === up.x && y === up.y);
      if (step) { g.handleKey(null, step); return 'toup'; }
    }
    st.wantsTown = false;   /* no way up from here — carry on */
    st.retreat = 0;
  }

  /* 1. A class power, if one fits: mend when hurt, strike when something is in
   *    reach. A refused working costs nothing, so this is safe to try. */
  if (tryAbility(g)) return 'power';

  /* 2. Something beside us: hit it. */
  const near = hostiles(g).filter((m) => cheb(m, p) <= 1);
  if (near.length) {
    setGoal(st, { kind: 'monster', m: near[0] });
    const m = near[0];
    g.handleKey(null, { dx: Math.sign(m.x - p.x), dy: Math.sign(m.y - p.y) });
    return 'fight';
  }
  /* 2. Loot underfoot. */
  if ((floor.items || []).some((it) => it.x === p.x && it.y === p.y)) { g.handleKey('g'); return 'loot'; }
  /* 3. Hurt: a draught works in a fight, resting does not. Rest only up to the
   *    cap rest can reach — past it the wound "will not close on its own", and
   *    resting forever is a loop, not a recovery. Then only the inn will do. */
  if (p.hp < p.maxhp * 0.5 && potion(g)) return 'drink';
  const restCap = g.restedCap(p);
  if (g.outOfCombat() && p.hp < Math.min(p.maxhp * 0.7, restCap)) {
    g.rest(Math.min(50, Math.max(4, Math.round((p.maxhp - p.hp) / 2))));
    return 'rest';
  }
  if (!bossHere && p.hp < p.maxhp * 0.5 && p.hp >= restCap) st.wantsTown = true;   /* only an inn closes it */

  /* 4. Follow the STICKY goal. Choosing afresh every turn made the bot walk
   *    toward loot, spot a monster behind it, walk back, and oscillate for
   *    four thousand turns. Commit, and only change targets when one is gone. */
  if (st.goal && goalValid(g, st.goal)) {
    /* A goal that has not been reached in a while is not being chased but
     * circled. Forget it, and remember not to pick it again soon. */
    if (st.turn - (st.goalSince || 0) > 60) {
      st.avoid.add(goalKey(st.goal));
      st.goal = null;
    }
  }
  if (st.goal && goalValid(g, st.goal)) {
    const gp = goalPos(st.goal);
    if (p.x === gp.x && p.y === gp.y) {
      if (st.goal.kind === 'stair') {
        /* A monster at your heels bars the descent ("Something at your
         * heels..."), and standing on the stair calling stepOn again forever
         * never clears it. Turn and fight the blocker; the stairs will keep. */
        const climbing = floor.up && gp.x === floor.up.x && gp.y === floor.up.y;
        const blocker = !climbing && hostiles(g).find((m) => cheb(m, p) <= 2);
        if (blocker) st.goal = { kind: 'monster', m: blocker };
        else { st.goal = null; st.avoid = new Set(); return climbOrDescend(g, gp.x, gp.y); }   /* a new floor is a new map */
      } else {
        st.goal = null;
      }
    } else {
      const step = routeMove(floor, p, (x, y) => x === gp.x && y === gp.y);
      if (step) { g.handleKey(null, step); return 'goal'; }
      st.goal = null;
    }
  }

  /* 5. Choose the first REACHABLE goal from a priority list: the boss on the
   *    last floor, a nearby hostile, loot, then the way on. An unreachable one
   *    (behind a wall or a locked seam) is skipped, not searched at. */
  const boss = hostiles(g).find((m) => m.boss);
  const cands = [];
  if (floor.isLast && boss) cands.push({ kind: 'monster', m: boss });
  /* A monster at your heels bars the descent ("Something at your heels..."),
   * so clear the ones within a step or two before trying the stairs. */
  for (const m of hostiles(g).filter((m) => cheb(m, p) <= 2)) cands.push({ kind: 'monster', m });
  /* On a floor that is not the last, clear it before moving on: experience is
   * the only armour that never comes off, and the boss waits whole no matter how
   * many times you retreat from it. */
  if (!floor.isLast) for (const m of hostiles(g).filter((m) => cheb(m, p) > 2)) cands.push({ kind: 'monster', m });
  for (const it of (floor.items || []).filter((x) => !x.auto)) cands.push({ kind: 'item', x: it.x, y: it.y });
  /* On the last floor the way on is back up — but you ARRIVE on the up-stair,
   * so until the boss is dead that stair is a trap: the bot would step down,
   * stand on it, and climb straight back, forever. The exit only counts once
   * the floor's business is finished. */
  const stair = floor.isLast ? (boss ? null : floor.up) : floor.down;
  if (stair) cands.push({ kind: 'stair', x: stair.x, y: stair.y });
  for (const c of cands) {
    if (st.avoid.has(goalKey(c))) continue;
    const gp = goalPos(c);
    if (p.x === gp.x && p.y === gp.y) {
      if (c.kind === 'stair') { st.goal = null; st.avoid = new Set(); return climbOrDescend(g, gp.x, gp.y); }
      setGoal(st, c); return 'goal';
    }
    const step = routeMove(floor, p, (x, y) => x === gp.x && y === gp.y);
    if (step) {
      const bx = p.x, by = p.y;
      setGoal(st, c);
      g.handleKey(null, step);
      if (process.env.SIM_DEBUG && p.x === bx && p.y === by && c.kind !== 'stair') {
        const tx = bx + step.dx, ty = by + step.dy;
        console.log('  refused', goalKey(c), 'at', bx + ',' + by, 'delta', step.dx + ',' + step.dy,
          'tile', floor.tiles[ty] && floor.tiles[ty][tx], 'ooc', g.outOfCombat(),
          'blockers', (g.state.party.members || []).concat(floor.monsters || [], floor.npcs || [])
            .filter((m) => m && m.x === tx && m.y === ty).map((m) => m.name || m.id || '?').join(','));
      }
      return 'goal';
    }
  }
  /* 6. Nothing reachable. A secret is found by walking the walls, not by
   *    staring at one brick: search now and then, and otherwise take the
   *    unexplored way, so the bot sweeps the floor instead of freezing on it. */
  if (st.turn % 4 === 0 && searchABit(g)) return 'search';
  const explored = exploreStep(g, st);
  if (explored) return explored;
  if (searchABit(g)) return 'search';
  g.handleKey(' '); return 'wait';
}

/* The best open direction from (x,y): unseen first, never back the way we came
 * unless there is nothing else, and never straight into a friend. Null when
 * boxed in. */
function bestDir(g, x, y, back) {
  const floor = g.currentFloor;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const opts = [];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    const t = floor.tiles[ny] && floor.tiles[ny][nx];
    if (!(isTravelable(t) || t === T.DOOR_C)) continue;
    if (g.memberAt && g.memberAt(nx, ny)) continue;   /* a friend is not a tile */
    opts.push({ dx, dy, unseen: !(g.seen && g.seen[ny] && g.seen[ny][nx]), back: back && back.x === nx && back.y === ny });
  }
  if (!opts.length) return null;
  opts.sort((a, b) => (b.unseen - a.unseen) || (a.back - b.back));
  return { dx: opts[0].dx, dy: opts[0].dy };
}

/* One step toward the unexplored. A friend in the way is slipped past with the
 * route's continuation, not walked into and rebounded off. Returns null when
 * every neighbour is known/blocked. */
function exploreStep(g, st) {
  const p = g.state.player;
  const d = bestDir(g, p.x, p.y, st.lastPos);
  if (!d) return null;
  const step = { dx: d.dx, dy: d.dy };
  const nx = p.x + d.dx, ny = p.y + d.dy;
  if (g.memberAt && g.memberAt(nx, ny)) {
    const ex = bestDir(g, nx, ny, { x: p.x, y: p.y });
    if (ex) { step.exitDx = ex.dx; step.exitDy = ex.dy; }
  }
  st.lastPos = { x: p.x, y: p.y };
  g.handleKey(null, step);
  return 'explore';
}

/* Drink the leader's best healing draught, if the company has one. */
function potion(g) {
  const p = g.state.player;
  const it = p.inventory.find((x) => x.id === 'potion-major-heal') || p.inventory.find((x) => x.id === 'potion-heal');
  if (!it) return false;
  g.useItem(it);
  return true;
}

/* The class powers, used rather than forgotten. Heal when hurt; otherwise hit
 * with the cheapest damage working that can reach. activateAbility refuses
 * (and costs nothing) when there is no target, so the reach test is a hint, not
 * a guarantee — and after the call we ask the ledger whether it actually took. */
function tryAbility(g) {
  const p = g.state.player;
  const der = g.derived();
  const ready = abilitiesFor(p.cls, p.level).filter((a) => a.kind !== 'passive' &&
    p.power >= (a.powerCost || 0) && !(p.cooldowns[a.id] > 0));
  if (!ready.length) return false;
  const fire = (a) => {
    const power = p.power, cd = p.cooldowns[a.id] || 0, hp = p.hp;
    g.activateAbility(a.id);
    return p.power < power || (p.cooldowns[a.id] || 0) > cd || p.hp !== hp;   /* did it take? */
  };
  /* Heal first, when hurt. */
  if (p.hp < p.maxhp * 0.45) {
    const heal = ready.find((a) => a.kind === 'heal');
    if (heal && fire(heal)) return true;
  }
  /* A damage working at something in reach — but keep a reserve for mending. */
  const bad = hostiles(g);
  if (bad.length && p.power > der.maxpower * 0.35) {
    const dmg = ready.filter((a) => a.kind === 'damage')
      .filter((a) => bad.some((m) => cheb(m, p) <= (a.range || 1)))
      .sort((x, y) => (x.powerCost || 0) - (y.powerCost || 0))[0];
    if (dmg && fire(dmg)) return true;
  }
  return false;
}

/* One deliberate step in a turning direction — the stall-breaker's kick. Doors
 * count (a bump opens them); monsters do not. */
function nudge(g, st) {
  const p = g.state.player, floor = g.currentFloor;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  st.spin = (st.spin || 0) + 1;
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = dirs[(st.spin + i) % 4];
    const t = floor.tiles[p.y + dy] && floor.tiles[p.y + dy][p.x + dx];
    if (isTravelable(t) || t === T.DOOR_C) { g.handleKey(null, { dx, dy }); return 'nudge'; }
  }
  g.handleKey(' '); return 'wait';
}

/* The town errand: dump loot, mend at the inn, stock up, fill the ranks. */
function townRoutine(g) {
  for (const m of g.state.party.members) {
    if (!m) continue;
    for (const it of [...m.inventory]) {
      if (it.kind === 'potion' || it.kind === 'scroll') continue;
      sellItem(g, it, m);
    }
  }
  const fallen = fallenMembers(g);
  for (const dead of fallen) if (g.purse() > 120) raiseMember(g, dead);
  if (g.state.player.hp < g.state.player.maxhp) takeRoom(g);
  /* Companions first: a second body is worth more than a belt of draughts. */
  let guard = 6;
  const order = ['fighter', 'thief', 'cleric', 'mage'];
  while (guard-- > 0 && g.state.party.members.length < 4) {
    /* Keep enough coin for a room: a company that hires itself broke and then
     * cannot afford to mend loops between the inn and the door for ever. */
    if (g.purse() - hireCost(g) < 45) break;
    const cls = order[g.state.party.members.length % order.length];
    if (!hireMember(g, cls)) break;
  }
  /* Steel before swill: equip what the company already hauls, then buy the best
   * arm the rack will sell, and put it on. A company rich in gold and poor in
   * iron dies on the boss floor with a full purse. */
  gearUp(g);
  buyGear(g);
  gearUp(g);
  guard = 12;
  while (guard-- > 0 && g.purse() > 90 && buyItem(g, 'potion-heal', g.state.player)) { /* then stock */ }
}

/* Put each member's best weapon, body armour and shield on them. */
function gearUp(g) {
  const tier = (it) => (it && it.tier) || 0;
  for (const m of g.state.party.members) {
    if (!m || m.hp <= 0 || !m.equipment) continue;
    for (const slot of ['weapon', 'body', 'shield']) {
      const cur = m.equipment[slot];
      const best = (m.inventory || []).filter((it) => it.slot === slot).sort((a, b) => tier(b) - tier(a))[0];
      if (best && tier(best) > tier(cur)) g.equip(best, m);
    }
  }
}

/* Buy the leader the best affordable upgrade in each worn slot. */
function buyGear(g) {
  const leader = g.state.player;
  const stock = shopStock(g);
  const tier = (it) => (it && it.tier) || 0;
  for (const slot of ['weapon', 'body', 'shield']) {
    const want = stock
      .map((s) => ({ s, t: getItemTemplate(s.id) }))
      .filter((x) => x.t && x.t.slot === slot)
      .sort((a, b) => tier(b.t) - tier(a.t))[0];
    if (!want || want.t.tier <= tier(leader.equipment && leader.equipment[slot])) continue;
    if (g.purse() - want.s.price < 45) continue;   /* keep a room's worth in reserve */
    if (!buyItem(g, want.s.id, leader)) continue;
    const got = leader.inventory.find((it) => it.id === want.s.id);
    if (got) g.equip(got, leader);
  }
}

/* The next founding sanctum still holding its boss. Once all three are quiet,
 * the chronicle is won — endless halls past them are a test, not a finish. When
 * `at` is set, the run stays in that one place, so the deep content can be
 * exercised without first clearing the founding three. */
function pickDungeon(g, at) {
  if (at) {
    const d = g.dungeonById(at);
    if (!d || g.isDungeonCleared(d.id)) return null;
    if (g.dungeonBarred(d)) return null;   /* the company fell back under the gate */
    return d;
  }
  const bases = g.baseDungeonIds();
  return g.availableDungeons().find((d) => bases.includes(d.id) && !g.isDungeonCleared(d.id)) || null;
}

/* ---- one whole run ---- */

function playRun(seed, clsId, opts = {}) {
  const cap = opts.cap || 4000;
  const g = makeGame(seed, clsId);
  if (opts.gold) g.earnGold(opts.gold);
  /* --at: drop the company straight into a named place at the level it was cut
   * for, with the founding gates already open, so the bot can test any area. */
  if (opts.at) {
    const d = g.dungeonById(opts.at);
    if (!d) throw new Error('no such dungeon: ' + opts.at);
    g.state.player.bossesSlain = { temple: true, upper: true, serpent: true };
    const need = d.minLevel || (Array.isArray(d.level) ? d.level[0] : 0) || 1;
    g.state.player.level = Math.max(g.state.player.level || 1, need);
    /* Enough to muster a full party at the level the place was cut for. */
    if (!opts.gold) g.earnGold(400 + need * 150);
    /* Kit out first, the way a run would: the point is to test the area, not to
     * watch a naked level-six company die at the door. */
    g.enterTown('temple', 'the-whetstone');
    townRoutine(g);
    g.enterDungeon(d.id);
  }
  const report = { seed, cls: clsId, outcome: 'cap', deepest: 0, level: 1, gold: 0, kills: 0, turns: 0, party: 1, error: null, actions: {} };
  try {
    let turns = 0;
    let townTrips = 0;
    const st = { wantsTown: false };
    while (turns < cap) {
      if (g.dying) { report.outcome = 'died'; break; }
      const p = g.state.player;
      report.level = Math.max(report.level, p.level);
      report.deepest = Math.max(report.deepest, (p.floorIdx || 0));
      report.party = g.state.party.members.length;
      if (g.inTown()) {
        townRoutine(g);
        townTrips++;
        if (townTrips > 60) { report.outcome = 'loop'; break; }   /* never left town */
        const next = pickDungeon(g, opts.at);
        if (!next) { report.outcome = 'won'; break; }
        st.wantsTown = false;
        st.retreat = 0;
        st.goal = null;
        st.avoid = new Set();
        g.enterDungeon(next.id);
      } else {
        const flBefore = p.floorIdx;
        const a = dungeonTurn(g, st);
        report.actions[a] = (report.actions[a] || 0) + 1;
        if (process.env.SIM_DEBUG && turns % 1000 === 0) {
          console.log('  ' + seed, 't' + turns, 'dun', p.dungeonId, 'fl', flBefore + '->' + p.floorIdx, 'at', p.x + ',' + p.y, 'hp', p.hp + '/' + p.maxhp, 'wt', st.wantsTown, 'act', a, 'goal', st.goal ? goalKey(st.goal) : '-');
        }
        /* Progress is what the run is actually gaining: health, depth, kills,
         * coin, pack, level. A chase or a stare-off moves the body but none of
         * these. Watch a window, not the last turn, so an up/down or rest loop
         * that alternates two states is caught too. */
        const sig = [p.hp, p.floorIdx, g.state.totalKills || 0, g.purse(), p.inventory.length, p.level].join('#');
        const seen = (st.recent = st.recent || []).filter((s) => s === sig).length;
        st.recent.push(sig);
        if (st.recent.length > 8) st.recent.shift();
        if (seen >= 4 && !st.wantsTown) { st.goal = null; st.force = true; st.recent = []; }
      }
      turns++;
    }
    report.turns = turns;
    report.gold = g.purse();
    report.kills = g.state.totalKills || 0;
    report.towns = townTrips;
    report.tail = (g.logs || []).slice(-10);
  } catch (e) {
    report.outcome = 'error';
    report.error = (e && e.stack) || String(e);
  }
  return report;
}

/* ---- the CLI + the two reports ---- */

function parseArgs(argv) {
  const o = { runs: 24, baseSeed: 'sim', cap: 4000, verbose: false, seed: null, cls: null, gold: 0, at: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = Math.max(1, parseInt(argv[++i], 10) || 24);
    else if (a === '--cap') o.cap = Math.max(100, parseInt(argv[++i], 10) || 4000);
    else if (a === '--seed') o.seed = argv[++i];
    else if (a === '--cls') o.cls = argv[++i];
    else if (a === '--gold') o.gold = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--at') o.at = argv[++i];
    else if (a === '--verbose') o.verbose = true;
  }
  return o;
}

const CLASSES = ['fighter', 'thief', 'cleric', 'mage'];
const mean = (a) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0);
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '0%');

function main() {
  const o = parseArgs(process.argv.slice(2));
  const runs = [];
  const errors = [];
  for (let i = 0; i < o.runs; i++) {
    const seed = o.seed ? `${o.seed}-${i}` : `${o.baseSeed}-${i}`;
    const cls = o.cls || CLASSES[i % CLASSES.length];
    const r = playRun(seed, cls, { cap: o.cap, gold: o.gold, at: o.at });
    runs.push(r);
    if (o.verbose) {
      console.log(`  ${r.outcome.padEnd(6)} ${seed.padEnd(14)} ${r.cls.padEnd(8)} depth ${(r.deepest + 1)}  lvl ${String(r.level).padStart(2)}  ${String(r.gold).padStart(5)}g  ${String(r.kills).padStart(3)} kills  ${r.turns} turns  ${r.towns || 0} town`);
      if (r.tail && r.outcome !== 'won') console.log('         ' + r.tail.slice(-4).join('  |  ').slice(0, 200));
      console.log('         actions: ' + Object.entries(r.actions).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ' ' + v).join(' · '));
    }
    if (r.error) errors.push(r);
  }

  const outcomes = {};
  for (const r of runs) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
  const died = runs.filter((r) => r.outcome === 'died');
  const won = runs.filter((r) => r.outcome === 'won');

  console.log('\n=== BALANCE ===');
  console.log('runs      ' + runs.length + '  (cap ' + o.cap + ' turns)' + (o.at ? '   at ' + o.at : ''));
  console.log('outcomes  ' + Object.entries(outcomes).map(([k, v]) => k + ' ' + v).join(' · '));
  console.log('depth     mean ' + (mean(runs.map((r) => r.deepest)) + 1).toFixed(1) + ' floors   deepest ' + (Math.max(...runs.map((r) => r.deepest)) + 1));
  console.log('level     mean ' + mean(runs.map((r) => r.level)).toFixed(1) + '   at death ' + (died.length ? mean(died.map((r) => r.level)).toFixed(1) : '—'));
  console.log('gold      mean ' + Math.round(mean(runs.map((r) => r.gold))) + '   kills mean ' + Math.round(mean(runs.map((r) => r.kills))));
  console.log('survived  ' + pct(won.length, runs.length) + ' won · ' + pct(died.length, runs.length) + ' died · ' + pct(runs.filter((r) => r.outcome === 'error').length, runs.length) + ' errored');
  console.log('party     mean ' + mean(runs.map((r) => r.party)).toFixed(1) + ' of 4');

  console.log('\n=== BUGS ===');
  if (!errors.length) {
    console.log('none — ' + runs.length + ' runs, no exceptions thrown');
  } else {
    const seen = new Map();
    for (const r of errors) {
      const head = String(r.error).split('\n').slice(0, 3).join(' \u2192 ');
      if (!seen.has(head)) seen.set(head, []);
      seen.get(head).push(r.seed);
    }
    for (const [head, seeds] of seen) {
      console.log('  \u00d7' + seeds.length + '  ' + head);
      console.log('      seeds: ' + seeds.slice(0, 5).join(', '));
    }
  }
  return errors.length ? 1 : 0;
}

const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMain) process.exit(main());
