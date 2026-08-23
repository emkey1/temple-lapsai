/* WHAT A THING DOES.
 *
 * A "+1 Lucky Coin of Lapsai" told you its name and nothing else: the effects
 * were on the object, read by the engine every turn, and never once shown. So
 * every ring in the pack was a guess, and the whole point of choosing what to
 * wear was invisible.
 *
 * Written from the same fields derived() and consumeItem() actually read — if
 * an effect is listed here, something in the engine acts on it. Kept out of
 * main.js and free of the DOM so a test can hold it to that.
 */

import { healFractionForItem, healFractionForAbility, healthShare, RECOVERY } from './base.js';

export function dieText(d) {
  if (d === null || d === undefined) return '';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d;
  return d.dice + 'd' + d.sides + (d.bonus ? (d.bonus > 0 ? '+' : '') + d.bonus : '');
}

/* The best the dice can do, so the panel can tell you when they no longer
 * matter: past a certain size of character the floor clears the whole range
 * and a Potion of Healing mends the same number every time. Printing "2d4+2"
 * at that point would be the old complaint all over again. */
function maxRoll(d) {
  if (d === null || d === undefined) return 0;
  if (typeof d === 'number') return d;
  if (typeof d === 'object') return (d.dice || 1) * (d.sides || 6) + (d.bonus || 0);
  const m = String(d).match(/(\d+)d(\d+)([+-]\s*\d+)?/i);
  if (!m) return Number(d) || 0;
  return Number(m[1]) * Number(m[2]) + (m[3] ? Number(m[3].replace(/\s+/g, '')) : 0);
}

function healLine(it, fx, maxhp) {
  const fraction = healFractionForItem(it);
  const each = it && it.kind === 'wand' ? 'each charge mends ' : 'mends ';
  const share = healthShare(fraction);
  if (!(maxhp > 0) || !fraction) {
    return each + dieText(fx.heal) + ' hp, or ' + share + ' — whichever is more';
  }
  const floor = Math.max(1, Math.round(maxhp * fraction));
  if (floor >= maxRoll(fx.heal)) return each + floor + ' hp — ' + share;
  return each + dieText(fx.heal) + ' hp, never less than ' + floor + ' — ' + share;
}

const STAT_NAME = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

export function itemEffectLines(it, ctx) {
  const fx = (it && it.effects) || {};
  const maxhp = ctx && ctx.maxhp;
  const out = [];
  const plus = (n) => (n > 0 ? '+' + n : String(n));

  if (fx.damage) out.push(dieText(fx.damage) + ' damage');
  if (fx.toHit) out.push(plus(fx.toHit) + ' to hit');
  /* AC descends, so an acBonus of 2 is armour worth two points. Saying "+2 AC"
   * of a number that goes down is how you teach someone the wrong rule. */
  if (fx.acBonus) out.push(plus(fx.acBonus) + ' armour');
  if (fx.statBonus) {
    for (const k of Object.keys(fx.statBonus)) {
      if (fx.statBonus[k]) out.push(plus(fx.statBonus[k]) + ' ' + (STAT_NAME[k] || k.toUpperCase()));
    }
  }
  /* The floor is part of what the thing does, so it is part of what the thing
   * says. A potion that quietly mends a quarter of your health while its own
   * label promises 2d4+2 is the same failure as one that says nothing. */
  if (fx.heal) {
    out.push(healLine(it, fx, maxhp));
    /* Why you carry one at all, once sitting down has a limit. */
    out.push('reaches past the rested line, and closes ' + Math.round(RECOVERY.healMends * 100) + '% of what it mends');
  }
  if (fx.power) out.push('restores ' + dieText(fx.power) + ' power');
  if (fx.regen) out.push('mends ' + fx.regen + ' hp a turn, up to the rested line');
  if (fx.resist) out.push('soaks ' + fx.resist + ' damage from every blow');
  if (fx.undeadResist) out.push('soaks ' + fx.undeadResist + ' more from undead and cursed things');
  if (fx.luck) out.push('a second look at ' + Math.round(Math.min(0.6, fx.luck * 0.15) * 100) + '% of the blows you miss with');
  if (fx.seeSecrets) out.push('shows secret doors');
  if (fx.spell && !(fx.spell === 'heal' && fx.heal)) out.push('casts ' + fx.spell);
  if (fx.charges !== undefined) out.push(fx.charges + ' charge' + (fx.charges === 1 ? '' : 's') + ' left');
  if (fx.buffStr) out.push('+4 STR for ' + fx.buffStr + ' turns');
  if (fx.removeCurse) out.push('lifts every curse you carry');
  if (fx.identify) out.push('names everything you carry');
  if (fx.teleport) out.push('throws you somewhere else on this floor');
  if (fx.map) out.push('draws the whole floor, secrets and all');
  if (fx.flame) out.push('burns the nearest foe for ' + dieText(fx.flame));
  if (fx.sanctuary) out.push('the dark forgets you for ' + fx.sanctuary + ' turns');
  if (fx.property) out.push(String(fx.property));
  return out;
}

export function itemDescription(it, ctx) {
  if (!it) return '';
  const lines = itemEffectLines(it, ctx);
  /* Treasure does nothing but be worth something, which is worth saying. */
  if (!lines.length && it.kind === 'special') lines.push('worth ' + (it.value || 0) + ' gp to the right buyer');
  if (it.cursed) lines.push('cursed — it will not come off');
  if (!lines.length) return '';
  return lines.join(' · ');
}


/* Abilities carry their own hand-written description, and the ones that heal
 * promise a die roll they may well beat. The stat sheet appends this, so a
 * power the Library invented is as honest about its floor as the four that
 * shipped in the box — neither has to remember to say so. */
export function abilityHealNote(a, ctx) {
  if (!a || a.kind !== 'heal') return '';
  const fraction = healFractionForAbility(a);
  if (!fraction) return '';   /* a power with no floor promises only its dice */
  const share = healthShare(fraction);
  const maxhp = ctx && ctx.maxhp;
  if (!(maxhp > 0)) return 'at least ' + share;
  return 'at least ' + Math.max(1, Math.round(maxhp * fraction)) + ' — ' + share;
}

/* A renewal the player cannot see is one they cannot plan around — and a
 * fraction of a point a turn reads as nothing, so it is quoted over ten turns
 * of fighting, which is about a third of a boss. */
export function abilityPowerNote(a, ctx) {
  if (!a) return '';
  const maxpower = ctx && ctx.maxpower;
  const parts = [];
  if (a.powerRegen > 0) {
    parts.push(maxpower > 0
      ? '+' + Math.floor(maxpower * a.powerRegen * 10) + ' pwr over ten turns of fighting'
      : Math.round(a.powerRegen * 100) + '% of your power a turn while fighting');
  }
  if (a.focusPower > 0) parts.push('+' + a.focusPower + ' pwr on a blow landed with a focus');
  return parts.join(' · ');
}
