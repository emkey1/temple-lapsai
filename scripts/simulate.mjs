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

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Game, initialStats, PACK_LIMIT } from '../public/js/engine.js';
import { abilitiesFor, getItemTemplate } from '../public/js/base.js';
import { T, W, H, isTravelable } from '../public/js/mapgen.js';
import { shopStock, buyItem, sellItem, takeRoom, hireMember, hireCost, raiseMember, fallenMembers } from '../public/js/town.js';

/* ---- the rig ---- */

/* A Library expansion file (data/expansions.json) is a flat list of validated
 * entries, each with an id and a type. Fold them into the registry shape the
 * engine reads — the same mapping main.js's installExpansion does — so a
 * written dungeon can be entered with --registry and --at. */
function registryFromEntries(entries) {
  const reg = { items: [], monsters: [], dungeons: [], abilities: [] };
  for (const exp of Array.isArray(entries) ? entries : []) {
    if (!exp || !exp.id) continue;
    if (exp.type === 'monster') { reg.monsters.push(exp); continue; }
    if (exp.type === 'item') { reg.items.push(exp); continue; }
    if (exp.type === 'ability') { reg.abilities.push(exp); continue; }
    if (exp.type !== 'dungeon') continue;
    const monsters = (exp.monsters || []).filter((m) => m && m.id);
    const boss = exp.boss && exp.boss.id ? exp.boss : null;
    reg.dungeons.push({
      id: exp.id, type: 'dungeon',
      name: exp.name, title: exp.title, flavor: exp.flavor,
      floors: exp.floors || 3, theme: exp.theme || 'temple', threat: exp.threat || 0,
      monsterWeights: [...monsters.map((m) => m.id), boss ? boss.id : null].filter(Boolean),
      bossId: boss ? boss.id : null,
      requires: exp.requires || 'serpent',
      minLevel: exp.minLevel || 0,
      level: exp.level || null,
      region: exp.region || null,
      regionNote: exp.regionNote || '',
      written: true,
    });
  }
  return reg;
}

function makeGame(seed, clsId, registry) {
  const logs = [];
  const ui = {
    log: (m) => logs.push(String(m)),
    render() {}, refreshHud() {}, setLocation() {}, showArrival() {}, showBeat() {},
    showFloor() {}, showVictory() {}, showCamp() {}, unlock() {}, prepareTransition() {},
    openDialogue() {}, recordAccount() {}, showWelcome() {},
  };
  const g = new Game({ ui, registry: registry || undefined });
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

/* WHICH ENEMY IS WORTH HITTING FIRST. The win condition outranks everything,
 * then the bigger threat (a tier-9 thing over a tier-3 one), then the wounded —
 * so a monster someone has already cut is finished rather than left at one hit
 * point to keep dealing damage. Because every member re-reads hp as they act,
 * wounding-first is also FOCUS FIRE: the second attacker picks whoever the
 * first just bloodied, and the party removes one target instead of scratching
 * four. */
function cmpTarget(a, b, p) {
  const boss = (b.boss ? 1 : 0) - (a.boss ? 1 : 0);
  if (boss) return boss;
  const tier = ((b.t && b.t.tier) || 1) - ((a.t && a.t.tier) || 1);
  if (tier) return tier;
  if (a.hp !== b.hp) return a.hp - b.hp;
  return cheb(a, p) - cheb(b, p);
}
const sortTargets = (list, p) => [...list].sort((a, b) => cmpTarget(a, b, p));

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
  /* The advisor's stance scales how early the company turns back: cautious
   * runs home sooner, bold presses on. Absent an advisor it is always 'steady',
   * which is exactly the old rule. */
  const stance = st.stance || 'steady';
  const riskMul = stance === 'cautious' ? 1.6 : stance === 'bold' ? 0.6 : 1;
  /* On the boss floor there is nothing to retreat TO: the god is whole again
   * the moment you climb back down, so a retreat is a reset, not a rest — and
   * retreating just runs the clock. Commit: fight it out, win or die. */
  const hurt = !bossHere && p.hp < p.maxhp * 0.28 * riskMul;
  const laden = !bossHere && p.inventory.length >= PACK_LIMIT - 1;
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

  /* 0b. BOSS PREP. The floor below is the last one — the boss — so do not walk
   *     into it hurt. Top up here, where it is quiet, instead of finding out at
   *     the door. (The boss is whole again on every re-entry, so arriving at
   *     full is the only way a retreat ever helps.) */
  const dungeon = g.dungeonById(p.dungeonId) || {};
  const nextIsBoss = !floor.isLast && (p.floorIdx + 1) >= ((dungeon.floors || 0) - 1);
  if (nextIsBoss && g.outOfCombat() && p.hp < p.maxhp * 0.92) {
    if (p.hp < p.maxhp * 0.6 && potion(g)) return 'drink';
    if (p.hp < Math.min(p.maxhp * 0.95, g.restedCap(p))) {
      g.rest(Math.min(50, Math.max(4, Math.round((p.maxhp - p.hp) / 2))));
      return 'rest';
    }
  }

  /* 1. A class power, if one fits: mend when hurt, strike when something is in
   *    reach. A refused working costs nothing, so this is safe to try. */
  if (tryAbility(g)) return 'power';

  /* 2. Something beside us: hit the one worth hitting. */
  const near = sortTargets(hostiles(g).filter((m) => cheb(m, p) <= 1), p);
  if (near.length) {
    const m = near[0];
    setGoal(st, { kind: 'monster', m });
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
  const bossFloor = !!(floor.isLast && boss);
  const cands = [];
  if (bossFloor) cands.push({ kind: 'monster', m: boss });
  /* A monster at your heels bars the descent ("Something at your heels..."),
   * so clear the ones within a step or two before trying the stairs. NOT on the
   * boss floor, though: there the boss is the win, and chasing an add is time
   * the Demon spends killing a member one at a time. Commit to the god. */
  if (!bossFloor) {
    for (const m of sortTargets(hostiles(g).filter((m) => cheb(m, p) <= 2), p)) cands.push({ kind: 'monster', m });
    /* On a floor that is not the last, clear it before moving on: experience is
     * the only armour that never comes off, and the boss waits whole no matter
     * how many times you retreat from it. */
    if (!floor.isLast) for (const m of sortTargets(hostiles(g).filter((m) => cheb(m, p) > 2), p)) cands.push({ kind: 'monster', m });
  }
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
  /* Heal first, when anyone is hurt — by the company's worst wound, not only
   * our own, so a healer mends the member who needs it rather than watching
   * them fall while it swings a mace. */
  const living = g.state.party.members.filter((m) => m && m.hp > 0);
  const worst = living.length ? Math.min(...living.map((m) => m.hp / Math.max(1, m.maxhp))) : 1;
  const hurtPc = Math.min(p.hp / Math.max(1, p.maxhp), worst);
  if (hurtPc < 0.5) {
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

/* The town errand: dump loot, mend at the inn, stock up, fill the ranks.
 * `comp` is the class list the company hires into — the party shape under
 * test — so the bot can muster an all-mage line or a cleric behind two mages
 * rather than the same balanced four every time. */
function townRoutine(g, comp) {
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
  /* An empty list is a choice: --solo hires nobody. No list at all is the
   * balanced default. */
  const order = Array.isArray(comp) ? comp : ['fighter', 'thief', 'cleric'];
  /* Fill to leader + companions: a three-entry comp is the full four, a
   * two-entry one is exactly a trio (--party mage,mage is "a leader and two
   * mages"), so a shape can be sized as well as chosen. */
  while (guard-- > 0 && order.length && g.state.party.members.length < 1 + order.length) {
    /* Keep enough coin for a room: a company that hires itself broke and then
     * cannot afford to mend loops between the inn and the door for ever. */
    if (g.purse() - hireCost(g) < 45) break;
    const cls = order[(g.state.party.members.length - 1) % order.length];
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

/* ---- the optional oracle advisor ----
 *
 * OFF by default, and it is never given a default endpoint: `--advisor <url>
 * --model <name>` points it at any OpenAI-compatible server the player runs
 * (a local one, a federated one — their business, not the repo's). It is
 * consulted ONCE per floor, keyed by a fingerprint of class, company, place and
 * level, and answers with one word — cautious, steady or bold — that scales how
 * readily the company turns back. Anything else (no server, a timeout, a bad
 * reply) leaves the scripted 'steady' rule standing.
 *
 * The caching is the point: the verdict is fetched at most once per distinct
 * state, so a sweep stays fast, and identical seeds get identical advice, so
 * the balance numbers stay reproducible. This is the whole of the LLM's job —
 * a rare, high-level judgement call, never a turn-by-turn one. */
const advisorCache = new Map();
const STANCES = new Set(['cautious', 'steady', 'bold']);

/* ---- what the advisor is shown ----
 *
 * It used to be six fields, four of them about whichever member happened to
 * hold the reins: no party health, no power, no draughts, no gold, no monsters
 * and no floor — so a vision-capable model was asked to judge a fight it could
 * not see, and answered with a tic ("bold") rather than a reading. Now it gets
 * the company, the resources, what is near, and a map. */
const MAP_GLYPH = { 0: '#', 1: '.', 2: '+', 3: "'", 4: '#', 5: '<', 6: '>', 7: '~', 8: '!', 9: 'D' };

/* The floor around the company as characters: @ the company, M a monster, B the
 * boss, N a person, * loot, # wall, . floor, + door, < up, > down, ~ water. */
function advisorGrid(g, rx = 10, ry = 6) {
  const f = g.currentFloor, p = g.state.player;
  if (!f || !p) return [];
  const members = (g.state.party.members || []).filter(Boolean);
  const mons = (f.monsters || []).filter((m) => m.hp > 0 && !m.submerged);
  const rows = [];
  for (let y = p.y - ry; y <= p.y + ry; y++) {
    let row = '';
    for (let x = p.x - rx; x <= p.x + rx; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) { row += ' '; continue; }
      const me = members.find((m) => m.x === x && m.y === y && m.hp > 0);
      const dead = members.find((m) => m.x === x && m.y === y && m.hp <= 0);
      const mo = mons.find((m) => m.x === x && m.y === y);
      const np = (f.npcs || []).find((n) => n.x === x && n.y === y);
      const it = (f.items || []).find((i) => i.x === x && i.y === y);
      if (me) row += '@';
      else if (dead) row += 'x';
      else if (mo) row += mo.boss ? 'B' : 'M';
      else if (np) row += 'N';
      else if (it) row += '*';
      else row += (MAP_GLYPH[f.tiles[y][x]] || '#');
    }
    rows.push(row);
  }
  return rows;
}

/* The whole state: who is in the company and how they stand, what is in the
 * purse and the packs, what is awake and how far off, and where it all is. */
function advisorState(g) {
  const p = g.state.player, f = g.currentFloor;
  const d = g.dungeonById(p.dungeonId) || {};
  const members = (g.state.party.members || []).filter(Boolean);
  const leader = members[0] || p;
  const draughts = members.reduce((n, m) => n + (m.inventory || []).filter((it) => it.kind === 'potion').length, 0);
  const near = ((f && f.monsters) || []).filter((m) => m.hp > 0 && !m.submerged)
    .sort((a, b) => cheb(a, p) - cheb(b, p)).slice(0, 6)
    .map((m) => ({ id: (m.t && m.t.id) || m.id, hp: m.hp, tier: (m.t && m.t.tier) || 1, dist: cheb(m, p), boss: !!m.boss }));
  return {
    dungeon: d.name || p.dungeonId,
    floor: (p.floorIdx || 0) + 1,
    ofFloors: d.floors || undefined,
    lastFloor: !!(f && f.isLast),
    intendedLevel: g.levelBand(d) || undefined,
    leaderClass: leader.cls,
    party: members.map((m) => ({
      cls: m.cls, level: m.level, hp: m.hp, maxhp: m.maxhp,
      power: m.power, maxpower: (g.derived(m) || {}).maxpower, down: m.hp <= 0,
    })),
    gold: g.purse(),
    potions: draughts,
    kills: g.state.totalKills || 0,
    monstersNear: near,
    map: advisorGrid(g).join('\n'),
  };
}

/* ---- a picture, for a model that can see ----
 *
 * The same window rendered to a PNG and sent as an image part: a vision model
 * reads the room's shape at a glance where the character grid has to be spelled
 * out. Encoded by hand (IHDR/IDAT/IEND over zlib) so the repo stays dependency-
 * free, and only built when --advisor-image is asked for — plenty of endpoints
 * refuse image parts outright. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;   /* 8-bit, RGBA */
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const MAP_RGB = {
  '@': [120, 200, 120], x: [110, 60, 60], M: [205, 70, 60], B: [255, 92, 70],
  N: [205, 200, 120], '*': [235, 205, 90], '#': [72, 72, 68], '.': [28, 30, 26],
  '+': [150, 110, 60], "'": [150, 130, 80], '<': [220, 180, 90], '>': [220, 180, 90],
  '~': [40, 70, 100], '!': [180, 160, 220], D: [70, 45, 45], ' ': [12, 12, 12],
};
function advisorMapPng(g, cell = 14) {
  const rows = advisorGrid(g);
  const h = rows.length, w = rows[0] ? rows[0].length : 0;
  if (!w || !h) return null;
  const Wpx = w * cell, Hpx = h * cell;
  const buf = Buffer.alloc(Wpx * Hpx * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = MAP_RGB[rows[y][x]] || [128, 128, 128];
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          const i = ((y * cell + py) * Wpx + (x * cell + px)) * 4;
          buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = 255;
        }
      }
    }
  }
  return encodePng(Wpx, Hpx, buf);
}

async function adviseStance(g, opts, fingerprint) {
  const cfg = opts.advisor;
  if (!cfg || !cfg.url) return 'steady';
  if (advisorCache.has(fingerprint)) return advisorCache.get(fingerprint);
  const state = advisorState(g);
  const ask = 'Choose a stance for this party. Reply with ONE word only — cautious, steady, or bold — and nothing else.\n'
    + 'cautious: turn back to town early. bold: press on regardless.\n'
    + 'The map is the floor around the company: @ company, M monster, B boss, N person, * loot, # wall, . floor, + door, < up, > down, ~ water.\n'
    + JSON.stringify(state);
  let stance = 'steady';
  /* The image, when asked for: the same window as a PNG data URL. If the
   * encoding fails for any reason the text state alone goes instead. */
  let userContent = ask;
  if (cfg.image) {
    try {
      const png = advisorMapPng(g);
      if (png) {
        if (process.env.SIM_SAVE_MAP) fs.writeFileSync(process.env.SIM_SAVE_MAP, png);
        userContent = [
          { type: 'text', text: ask },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png.toString('base64') } },
        ];
      }
    } catch { /* fall back to text */ }
  }
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined;
    const res = await fetch(String(cfg.url).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify({
        model: cfg.model || undefined,
        messages: [
          { role: 'system', content: 'You answer with a single lowercase word and no other text.' },
          { role: 'user', content: userContent },
        ],
        /* A reasoning model thinks before it answers, so the cap is generous:
         * a tiny one truncates the thinking before any stance is spoken. */
        temperature: 0, max_tokens: 400, stream: false,
      }),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      const msg = ((data.choices || [])[0] || {}).message || {};
      const text = String((msg.content || '') + ' ' + (msg.reasoning || ''));
      /* Prefer a JSON stance; else the LAST mention, since a model that weighs
       * the options settles on the one it names last. */
      const jm = text.match(/"stance"\s*:\s*"(cautious|steady|bold)"/i);
      const hits = (text.toLowerCase().match(/cautious|steady|bold/g) || []);
      const pick = jm ? jm[1].toLowerCase() : hits[hits.length - 1];
      if (pick && STANCES.has(pick)) stance = pick;
    }
  } catch { /* no server, no answer — the scripted rule stands */ }
  advisorCache.set(fingerprint, stance);
  return stance;
}

/* ---- the optional oracle DRIVER ----
 *
 * The advisor sets a mood once a floor; the driver picks one STEP per turn,
 * which is what "let the model play it" actually means. Same endpoint, same
 * no-default rule, and bounded by --llm-turns: a whole run is thousands of
 * turns and a model answers in about a second, so this is a demonstration, not
 * a way to sweep. Any bad reply, refusal, or timeout falls straight back to the
 * scripted turn, so the bot never stalls waiting on a model. */
const DIR8 = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
const bearingName = (from, to) => {
  const ns = to.y < from.y ? 'north' : to.y > from.y ? 'south' : '';
  const ew = to.x > from.x ? 'east' : to.x < from.x ? 'west' : '';
  return [ns, ew].filter(Boolean).join('-') || 'here';
};

async function llmMove(g, opts) {
  const cfg = opts.advisor;
  if (!cfg || !cfg.url) return null;
  const p = g.state.player, f = g.currentFloor;
  const state = advisorState(g);
  state.monstersNear = ((f && f.monsters) || []).filter((m) => m.hp > 0 && !m.submerged)
    .sort((a, b) => cheb(a, p) - cheb(b, p)).slice(0, 6)
    .map((m) => ({
      id: (m.t && m.t.id) || m.id, hp: m.hp, tier: (m.t && m.t.tier) || 1,
      dir: bearingName(p, m), dist: cheb(m, p), boss: !!m.boss,
    }));
  const ask = 'You drive this party one step at a time. The @ is whoever holds the reins now. '
    + 'Reply with JSON only: {"move":"E"} — one of N, NE, E, SE, S, SW, W, NW, wait, pickup. '
    + 'Stepping into a monster attacks it. Go to what matters (loot, stairs, the boss); do not stand and be surrounded.\n'
    + JSON.stringify(state);
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined;
    const res = await fetch(String(cfg.url).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify({
        model: cfg.model || undefined,
        messages: [
          { role: 'system', content: 'You answer with compact JSON and nothing else.' },
          { role: 'user', content: ask },
        ],
        temperature: 0, max_tokens: 200, stream: false,
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const msg = ((data.choices || [])[0] || {}).message || {};
    const text = String((msg.content || '') + ' ' + (msg.reasoning || ''));
    const m = text.toLowerCase().match(/"move"\s*:\s*"([a-z]+)"/);
    const move = m ? m[1] : null;
    if (!move) return null;
    if (move === 'wait') { g.handleKey(' '); return 'wait'; }
    if (move === 'pickup') { g.handleKey('g'); return 'pickup'; }
    const d = DIR8[move];
    if (!d) return null;
    return g.handleKey(null, { dx: d[0], dy: d[1] }) ? move : null;
  } catch { return null; }
}

async function playRun(seed, clsId, opts = {}) {
  const cap = opts.cap || 4000;
  const g = makeGame(seed, clsId, opts.registry);
  if (opts.gold) g.earnGold(opts.gold);
  /* --at: drop the company straight into a named place at the level it was cut
   * for, with the founding gates already open, so the bot can test any area. */
  if (opts.at === 'road') {
    /* The road between the towns, which nothing else ever walks: set out from
     * the Whetstone and play it. It has no stairs down, so the bot will roam
     * its length collecting and fighting rather than leave — enough to prove
     * the generation, the wanderers and the toll all hold up. */
    g.state.player.bossesSlain = { temple: true, upper: true, serpent: true };
    if (!opts.gold) g.earnGold(600);
    g.enterTown('temple', 'the-whetstone');
    townRoutine(g, opts.comp);
    g.travelTo('far-reach');
  } else if (opts.at) {
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
    townRoutine(g, opts.comp);
    g.enterDungeon(d.id);
  }
  const report = { seed, cls: clsId, comp: opts.compName || 'balanced', outcome: 'cap', deepest: 0, level: 1, gold: 0, kills: 0, turns: 0, party: 1, error: null, actions: {} };
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
    townRoutine(g, opts.comp);
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
        /* The optional advisor speaks once per floor: a stance that scales how
         * readily the company turns back. The fingerprint is deliberately coarse
         * — the LEADER's class, the party shape, the place, the floor — so a
         * level-up, a hire or whose turn it is does not re-ask, and identical
         * states across seeds reuse one answer. (Using the active member's class
         * here asked afresh on every member's turn.) */
        const leader = g.state.party.members[0] || p;
        const fingerprint = leader.cls + '|' + (opts.compName || '') + '|' + p.dungeonId + '|' + (p.floorIdx || 0);
        if (opts.advisor && fingerprint !== st.advisedFor) {
          st.stance = await adviseStance(g, opts, fingerprint);
          st.advisedFor = fingerprint;
          (report.stances = report.stances || []).push(st.stance);
        }
        const flBefore = p.floorIdx;
        let a = null;
        /* The driver, when asked for: one model-chosen step, up to the budget.
         * A bad reply or a refused step falls back to the scripted turn. With
         * --llm-boss-only it only takes the reins on a last floor once the god
         * is awake — the one fight the scripted bot keeps losing, and short
         * enough that driving it costs a dozen calls instead of thousands. */
        const bossFight = !!(g.currentFloor && g.currentFloor.isLast
          && (g.currentFloor.monsters || []).some((m) => m.hp > 0 && m.boss && !m.submerged));
        if (opts.driver === 'llm' && (st.llmCalls || 0) < (opts.llmTurns || 0) && (!opts.llmBossOnly || bossFight)) {
          const mv = await llmMove(g, opts);
          st.llmCalls = (st.llmCalls || 0) + 1;
          if (mv) { a = 'llm-' + mv; report.llmMoves = [...(report.llmMoves || []).slice(-11), mv]; }
        }
        if (!a) a = dungeonTurn(g, st);
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
  const o = { runs: 24, baseSeed: 'sim', cap: 4000, verbose: false, seed: null, cls: null, gold: 0, at: null, party: null, advisor: null, model: null, advisorKey: null, advisorImage: false, driver: null, llmTurns: 0, llmBossOnly: false, registry: null, solo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = Math.max(1, parseInt(argv[++i], 10) || 24);
    else if (a === '--cap') o.cap = Math.max(100, parseInt(argv[++i], 10) || 4000);
    else if (a === '--seed') o.seed = argv[++i];
    else if (a === '--cls') o.cls = argv[++i];
    else if (a === '--gold') o.gold = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--at') o.at = argv[++i];
    else if (a === '--party') o.party = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--advisor') o.advisor = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--advisor-key') o.advisorKey = argv[++i];
    else if (a === '--advisor-image') o.advisorImage = true;
    else if (a === '--driver') o.driver = argv[++i];
    else if (a === '--llm-turns') o.llmTurns = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--llm-boss-only') o.llmBossOnly = true;
    else if (a === '--registry') o.registry = argv[++i];
    else if (a === '--solo') { o.solo = true; o.party = []; }
    else if (a === '--verbose') o.verbose = true;
  }
  return o;
}

const CLASSES = ['fighter', 'thief', 'cleric', 'mage'];
/* PARTY SHAPES. One of each class is one shape among many, and not the one the
 * game rewards most — a cleric holding up two mages is a classic for a reason.
 * Runs cycle through these (the leader class cycling separately, so a shape and
 * a leader vary independently), and --party pins the companions to measure one
 * shape on its own. The companions are what offerCompanions would hire. */
const COMPOSITIONS = [
  ['fighter', 'thief', 'cleric'],    // balanced: a second wall, a knife, a healer
  ['cleric', 'mage', 'mage'],        // a healer behind two casters
  ['mage', 'mage', 'mage'],          // glass, all of it
  ['fighter', 'fighter', 'fighter'], // the wall
  ['fighter', 'cleric', 'mage'],     // one of each, without the thief
  ['thief', 'thief', 'thief'],       // knives
];
const compLabel = (comps) => (comps && comps.length ? comps.join('+') : 'balanced');
const mean = (a) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0);
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '0%');

async function main() {
  const o = parseArgs(process.argv.slice(2));
  /* The advisor is opt-in and its endpoint is only ever given at the call: no
   * default lives in the repo, because the server is the player's own. */
  const advisor = o.advisor ? { url: o.advisor, model: o.model || null, key: o.advisorKey || null, image: !!o.advisorImage } : null;
  if (o.driver === 'llm' && !advisor) {
    console.error('--driver llm needs --advisor <url> to ask');
    return 2;
  }
  /* --registry folds a Library expansion file into the game, so a written
   * dungeon can be entered with --at and played like any other. */
  let registry = null;
  if (o.registry) {
    try { registry = registryFromEntries(JSON.parse(fs.readFileSync(o.registry, 'utf8'))); }
    catch (err) { console.error('could not read --registry ' + o.registry + ': ' + err.message); return 2; }
    if (!registry.dungeons.length) console.error('note: ' + o.registry + ' holds no dungeons');
  }
  /* Reject a typo'd class before spending minutes simulating it — a bad --cls
   * used to become ninety-six percent exceptions. */
  if (o.cls && !CLASSES.includes(o.cls)) {
    console.error('no such class: ' + o.cls + '  (one of: ' + CLASSES.join(', ') + ')');
    return 2;
  }
  if (o.party) {
    const bad = o.party.filter((c) => !CLASSES.includes(c));
    if (bad.length) {
      console.error('no such class in --party: ' + bad.join(', ') + '  (one of: ' + CLASSES.join(', ') + ')');
      return 2;
    }
  }
  const solo = !!o.solo;
  const runs = [];
  const errors = [];
  for (let i = 0; i < o.runs; i++) {
    const seed = o.seed ? `${o.seed}-${i}` : `${o.baseSeed}-${i}`;
    const cls = o.cls || CLASSES[i % CLASSES.length];
    const comps = (solo || (o.party && o.party.length === 0)) ? [] : ((o.party && o.party.length) ? o.party : COMPOSITIONS[i % COMPOSITIONS.length]);
    const compName = (solo || comps.length === 0) ? 'solo' : compLabel(comps);
    const r = await playRun(seed, cls, { cap: o.cap, gold: o.gold, at: o.at, comp: comps, compName, advisor, registry, driver: o.driver, llmTurns: o.llmTurns, llmBossOnly: !!o.llmBossOnly });
    runs.push(r);
    if (o.verbose) {
      console.log(`  ${r.outcome.padEnd(6)} ${seed.padEnd(14)} ${r.cls.padEnd(8)} ${r.comp.padEnd(24)} depth ${(r.deepest + 1)}  lvl ${String(r.level).padStart(2)}  ${String(r.gold).padStart(5)}g  ${String(r.kills).padStart(3)} kills  ${r.turns} turns  ${r.towns || 0} town` + (advisor ? '  advisor: ' + [...new Set(r.stances || [])].join(',') : '') + (r.llmMoves && r.llmMoves.length ? '  llm:' + r.llmMoves.join(',') : ''));
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
  console.log('runs      ' + runs.length + '  (cap ' + o.cap + ' turns)' + (o.at ? '   at ' + o.at : '') + (advisor ? '   advisor on' : ''));
  console.log('outcomes  ' + Object.entries(outcomes).map(([k, v]) => k + ' ' + v).join(' · '));
  console.log('depth     mean ' + (mean(runs.map((r) => r.deepest)) + 1).toFixed(1) + ' floors   deepest ' + (Math.max(...runs.map((r) => r.deepest)) + 1));
  console.log('level     mean ' + mean(runs.map((r) => r.level)).toFixed(1) + '   at death ' + (died.length ? mean(died.map((r) => r.level)).toFixed(1) : '—'));
  console.log('gold      mean ' + Math.round(mean(runs.map((r) => r.gold))) + '   kills mean ' + Math.round(mean(runs.map((r) => r.kills))));
  console.log('survived  ' + pct(won.length, runs.length) + ' won · ' + pct(died.length, runs.length) + ' died · ' + pct(runs.filter((r) => r.outcome === 'error').length, runs.length) + ' errored');
  console.log('party     mean ' + mean(runs.map((r) => r.party)).toFixed(1) + ' of 4');

  /* PARTY SHAPES, SIDE BY SIDE — which line of four actually survives. Only
   * when more than one shape was run, so a pinned --party stays a single line. */
  const byComp = new Map();
  for (const r of runs) {
    const b = byComp.get(r.comp) || { n: 0, won: 0, died: 0, other: 0, depth: 0, level: 0, party: 0 };
    b.n++;
    b.depth += r.deepest + 1;
    b.level += r.level;
    b.party += r.party;
    if (r.outcome === 'won') b.won++;
    else if (r.outcome === 'died') b.died++;
    else b.other++;
    byComp.set(r.comp, b);
  }
  if (byComp.size > 1) {
    console.log('\n=== PARTY SHAPES ===');
    const rows = [...byComp].sort((a, b) => b[1].n - a[1].n);
    for (const [name, b] of rows) {
      console.log('  ' + name.padEnd(24) + String(b.n).padStart(3) + ' runs · ' +
        pct(b.won, b.n).padStart(4) + ' won · ' + pct(b.died, b.n).padStart(4) + ' died · ' +
        (b.depth / b.n).toFixed(1) + ' deep · lvl ' + (b.level / b.n).toFixed(1) + ' · party ' + (b.party / b.n).toFixed(1));
    }
  }

  /* WHAT THE ADVISOR SAID, when one was bound: the stance mix it handed down,
   * and how many times it was actually asked (the rest were cache hits). */
  if (advisor) {
    const counts = {};
    for (const r of runs) for (const s of (r.stances || [])) counts[s] = (counts[s] || 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log('advisor   ' + (total
      ? Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') + '  (' + total + ' calls)'
      : 'on, but made no calls'));
  }

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
if (isMain) process.exit(await main());
