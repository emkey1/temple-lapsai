/* THE DESCENT IS ONE CURVE.
 *
 * Reported: "the second dungeon starts out WAY too easy, and the same is
 * likely true of the next one. They need to scale from the previous dungeon."
 *
 * Measured, it was worse than easy. The average monster on the Upper Reaches'
 * opening floor had 9 hit points against 17 on the Temple's last, its floor
 * held a seventh of the experience, and the commonest thing on either floor
 * was a Sewer Rat. Three causes compounded: every dungeon counted its floors
 * from zero, so the difficulty ramp restarted; the tier band had a ceiling but
 * no floor, so tier-0 vermin stayed in the pool for ever; and the draw is
 * weighted towards the gentlest thing in the pool, which made them the
 * commonest thing on every floor of the game.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, floorOf } from './helpers.mjs';
import { DUNGEONS, MONSTERS, getMonster, XP_FOR_LEVEL } from '../public/js/base.js';

/* Every floor of the game, in the order a player walks them. */
function descent() {
  const g = newGame('descent', 'fighter');
  const out = [];
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) out.push({ d, f, depth: g.floorDepth(d, f) });
  }
  return out;
}

/* Averaged over seeds, because one floor is a small sample of a random one. */
function floorProfile(dungeonId, floorIdx, seeds = 12) {
  let hp = 0, n = 0;
  let lowestTier = Infinity, highestTier = -Infinity;
  for (let s = 0; s < seeds; s++) {
    const { floor } = floorOf(dungeonId, floorIdx, `depth-${dungeonId}-${floorIdx}-${s}`);
    for (const m of floor.monsters) {
      if (m.boss) continue;
      hp += m.maxhp; n++;
      lowestTier = Math.min(lowestTier, m.t.tier);
      highestTier = Math.max(highestTier, m.t.tier);
    }
  }
  return { avgHp: n ? hp / n : 0, lowestTier, highestTier, count: n };
}

test('a dungeon starts where the one before it finished', () => {
  const g = newGame('start-depth', 'fighter');
  let expected = 0;
  for (const d of DUNGEONS) {
    assert.equal(g.dungeonStartDepth(d), expected,
      `${d.id} starts at depth ${g.dungeonStartDepth(d)} rather than ${expected}`);
    expected += d.floors;
  }
});

test('every floor of the game is deeper than the one before it', () => {
  const walk = descent();
  for (let i = 1; i < walk.length; i++) {
    assert.ok(walk[i].depth > walk[i - 1].depth,
      `${walk[i].d.id} floor ${walk[i].f + 1} is at depth ${walk[i].depth}, no deeper than the floor before it`);
  }
});

test('the second dungeon does not open softer than the first one closed', () => {
  /* The reported bug, as a number. */
  const templeEnd = floorProfile('temple', 3);
  const upperStart = floorProfile('upper', 0);
  assert.ok(upperStart.avgHp >= templeEnd.avgHp * 0.9,
    `the Upper Reaches opens at ${upperStart.avgHp.toFixed(0)} hp a monster against the Temple's closing ${templeEnd.avgHp.toFixed(0)}`);

  const upperEnd = floorProfile('upper', 3);
  const serpentStart = floorProfile('serpent', 0);
  assert.ok(serpentStart.avgHp >= upperEnd.avgHp * 0.9,
    `the Serpent opens at ${serpentStart.avgHp.toFixed(0)} hp a monster against the Upper Reaches' closing ${upperEnd.avgHp.toFixed(0)}`);
});

test('what you fought four floors ago is not still the commonest thing you meet', () => {
  /* The band has a floor as well as a ceiling. Without one, and with a draw
   * weighted towards the gentlest thing in the pool, Sewer Rats were the
   * commonest monster on the last floor of the second dungeon. */
  for (const d of DUNGEONS) {
    const last = floorProfile(d.id, d.floors - 1);
    const first = floorProfile(d.id, 0);
    assert.ok(last.lowestTier > first.lowestTier,
      `${d.id}: its last floor still spawns tier ${last.lowestTier}, the same as its first`);
  }
  const upperLast = floorProfile('upper', 3);
  assert.ok(upperLast.lowestTier >= 5,
    `the Upper Reaches still puts tier ${upperLast.lowestTier} monsters on its last floor`);
});

test('the whole descent gets harder, dungeon boundaries and all', () => {
  const walk = descent();
  const profiles = walk.map((w) => ({ ...w, ...floorProfile(w.d.id, w.f) }));
  for (let i = 1; i < profiles.length; i++) {
    const prev = profiles[i - 1], here = profiles[i];
    assert.ok(here.avgHp >= prev.avgHp * 0.9,
      `${here.d.id} floor ${here.f + 1} averages ${here.avgHp.toFixed(0)} hp against ` +
      `${prev.avgHp.toFixed(0)} on ${prev.d.id} floor ${prev.f + 1}`);
  }
});

test('a dungeon never spawns something its own roster does not hold', () => {
  for (const d of DUNGEONS) {
    const roster = new Set(d.monsterWeights || []);
    for (let f = 0; f < d.floors; f++) {
      const { floor } = floorOf(d.id, f, `roster-${d.id}-${f}`);
      for (const m of floor.monsters) {
        assert.ok(roster.has(m.t.id), `${d.id} floor ${f + 1} spawned a ${m.t.name}, which is not on its roster`);
      }
    }
  }
});

test('hit points rise with tier at the top of the bestiary', () => {
  /* Trimming the deep monsters to make a boss winnable left tier 11 weaker
   * than tier 10, and the Demon of Lapsai — nominally tier 13 — the feeblest
   * card above tier 9. Tier says where a thing is met; if it does not also
   * track how hard it hits, the band puts the wrong things on the floor. */
  const byTier = new Map();
  for (const m of MONSTERS) {
    if (m.tier < 8) continue;
    byTier.set(m.tier, Math.min(byTier.get(m.tier) ?? Infinity, m.hpMax));
  }
  const tiers = [...byTier.keys()].sort((a, b) => a - b);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(byTier.get(tiers[i]) >= byTier.get(tiers[i - 1]),
      `tier ${tiers[i]} starts at ${byTier.get(tiers[i])} hp, below tier ${tiers[i - 1]}'s ${byTier.get(tiers[i - 1])}`);
  }
});

test('each boss is met at the level it was measured against', () => {
  /* The XP coefficient is fitted to what the floors hold, so restocking the
   * floors moves it. These are the levels the three bosses were tuned at. */
  const want = { temple: [4, 6], upper: [9, 11], serpent: [12, 14] };
  const g = newGame('boss-level', 'fighter');
  let banked = 0;
  for (const d of DUNGEONS) {
    for (let f = 0; f < d.floors; f++) {
      let floorXp = 0, bossXp = 0;
      for (let s = 0; s < 8; s++) {
        const { floor } = floorOf(d.id, f, `blevel-${d.id}-${f}-${s}`);
        for (const m of floor.monsters) {
          if (m.boss) bossXp += (m.xp || 0); else floorXp += (m.xp || 0);
        }
      }
      floorXp = Math.round(floorXp / 8);
      bossXp = Math.round(bossXp / 8);
      if (f === d.floors - 1) {
        const atBoss = banked + floorXp;
        let level = 1, left = atBoss;
        while (left >= XP_FOR_LEVEL(level)) { left -= XP_FOR_LEVEL(level); level++; }
        const [lo, hi] = want[d.id];
        assert.ok(level >= lo && level <= hi,
          `${d.id}: its boss is met at level ${level}, outside the ${lo}-${hi} it was measured against`);
        banked = atBoss + bossXp;
      } else {
        banked += floorXp;
      }
    }
  }
});
