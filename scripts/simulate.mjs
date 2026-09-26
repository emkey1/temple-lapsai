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
import { T, W, H, isTravelable } from '../public/js/mapgen.js';
import { shopStock, buyItem, sellItem, takeRoom, hireMember, raiseMember, fallenMembers } from '../public/js/town.js';

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
  const startK = start.y * W + start.x;
  const prev = new Map([[startK, null]]);
  const q = [start];
  let goal = null;
  for (let i = 0; i < q.length && !goal; i++) {
    const c = q[i];
    if (!(c.x === start.x && c.y === start.y) && pred(c.x, c.y, floor.tiles[c.y][c.x])) { goal = c; break; }
    for (const [dx, dy] of DIRS) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const k = y * W + x;
      if (prev.has(k)) continue;
      const t = floor.tiles[y][x];
      if (!(isTravelable(t) || t === T.DOOR_C || pred(x, y, t))) continue;
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
/* Step onto a stair tile; up means town (eventually), down means deeper. */
function climbOrDescend(g, x, y) {
  const floor = g.currentFloor;
  g.stepOn(x, y);
  return (floor.up && x === floor.up.x && y === floor.up.y) ? 'climb' : 'descend';
}

/* A dungeon turn. Returns a short label for the metric of what it did. */
function dungeonTurn(g, st) {
  const p = g.state.player, floor = g.currentFloor;

  /* 0. Hurt badly, or carrying too much to fight well: go home. Climb the
   *    stairs one floor at a time until the up-stair on floor zero hands us to
   *    the town. A dead delver's balance numbers are worth nothing. */
  const hurt = g.outOfCombat() && p.hp < p.maxhp * 0.55;
  const laden = p.inventory.length >= PACK_LIMIT - 1;
  if (st.wantsTown || hurt || laden) {
    const up = floor.up;
    if (up && p.x === up.x && p.y === up.y) { g.stepOn(up.x, up.y); return 'climb'; }
    if (up) {
      const step = firstStepTo(floor, p, (x, y) => x === up.x && y === up.y);
      if (step) { st.wantsTown = true; g.handleKey(null, { dx: step.dx, dy: step.dy }); return 'toup'; }
    }
  }
  st.wantsTown = false;

  /* 1. Something beside us: hit it. */
  const near = hostiles(g).filter((m) => cheb(m, p) <= 1);
  if (near.length) {
    st.goal = { kind: 'monster', m: near[0] };
    const m = near[0];
    g.handleKey(null, { dx: Math.sign(m.x - p.x), dy: Math.sign(m.y - p.y) });
    return 'fight';
  }
  /* 2. Loot underfoot. */
  if ((floor.items || []).some((it) => it.x === p.x && it.y === p.y)) { g.handleKey('g'); return 'loot'; }
  /* 3. Hurt: a draught works in a fight, resting does not. */
  if (p.hp < p.maxhp * 0.5 && potion(g)) return 'drink';
  if (g.outOfCombat() && p.hp < p.maxhp * 0.7) {
    g.rest(Math.min(50, Math.max(4, Math.round((p.maxhp - p.hp) / 2))));
    return 'rest';
  }

  /* 4. Follow the STICKY goal. Choosing afresh every turn made the bot walk
   *    toward loot, spot a monster behind it, walk back, and oscillate for
   *    four thousand turns. Commit, and only change targets when one is gone. */
  if (st.goal && goalValid(g, st.goal)) {
    const gp = goalPos(st.goal);
    if (p.x === gp.x && p.y === gp.y) {
      if (st.goal.kind === 'stair') return climbOrDescend(g, gp.x, gp.y);
      st.goal = null;
    } else {
      const step = firstStepTo(floor, p, (x, y) => x === gp.x && y === gp.y);
      if (step) { g.handleKey(null, { dx: step.dx, dy: step.dy }); return 'goal'; }
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
  for (const it of (floor.items || []).filter((x) => !x.auto)) cands.push({ kind: 'item', x: it.x, y: it.y });
  const stair = floor.isLast ? floor.up : floor.down;
  if (stair) cands.push({ kind: 'stair', x: stair.x, y: stair.y });
  for (const c of cands) {
    const gp = goalPos(c);
    if (p.x === gp.x && p.y === gp.y) {
      if (c.kind === 'stair') return climbOrDescend(g, gp.x, gp.y);
      st.goal = c; return 'goal';
    }
    const step = firstStepTo(floor, p, (x, y) => x === gp.x && y === gp.y);
    if (step) { st.goal = c; g.handleKey(null, { dx: step.dx, dy: step.dy }); return 'goal'; }
  }
  /* 6. Stuck: search for a secret door to open the way. */
  if (searchABit(g)) return 'search';
  /* 7. Genuinely nothing to do — wander one step toward any open tile. */
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    const t = floor.tiles[p.y + dy] && floor.tiles[p.y + dy][p.x + dx];
    if (isTravelable(t)) { g.handleKey(null, { dx, dy }); return 'wander'; }
  }
  g.handleKey(' '); return 'wait';
}

/* Drink the leader's best healing draught, if the company has one. */
function potion(g) {
  const p = g.state.player;
  const it = p.inventory.find((x) => x.id === 'potion-major-heal') || p.inventory.find((x) => x.id === 'potion-heal');
  if (!it) return false;
  g.useItem(it);
  return true;
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
    const cls = order[g.state.party.members.length % order.length];
    if (!hireMember(g, cls)) break;
  }
  guard = 12;
  while (guard-- > 0 && g.purse() > 90 && buyItem(g, 'potion-heal', g.state.player)) { /* then stock */ }
}

function pickDungeon(g) {
  const open = g.availableDungeons().filter((d) => !g.isDungeonCleared(d.id));
  return open[0] || null;
}

/* ---- one whole run ---- */

function playRun(seed, clsId, opts = {}) {
  const cap = opts.cap || 4000;
  const g = makeGame(seed, clsId);
  if (opts.gold) g.earnGold(opts.gold);
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
        const next = pickDungeon(g);
        if (!next) { report.outcome = 'won'; break; }
        st.wantsTown = false;
        g.enterDungeon(next.id);
      } else {
        const a = dungeonTurn(g, st);
        report.actions[a] = (report.actions[a] || 0) + 1;
        if (process.env.SIM_DEBUG && turns >= 2000 && turns < 2008) {
          console.log('  t' + turns, 'at', p.x + ',' + p.y, 'goal', JSON.stringify(st.goal).slice(0, 50), 'act', a);
        }
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
  const o = { runs: 24, baseSeed: 'sim', cap: 4000, verbose: false, seed: null, cls: null, gold: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = Math.max(1, parseInt(argv[++i], 10) || 24);
    else if (a === '--cap') o.cap = Math.max(100, parseInt(argv[++i], 10) || 4000);
    else if (a === '--seed') o.seed = argv[++i];
    else if (a === '--cls') o.cls = argv[++i];
    else if (a === '--gold') o.gold = Math.max(0, parseInt(argv[++i], 10) || 0);
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
    const r = playRun(seed, cls, { cap: o.cap, gold: o.gold });
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
  console.log('runs      ' + runs.length + '  (cap ' + o.cap + ' turns)');
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
