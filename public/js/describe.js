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

export function dieText(d) {
  if (d === null || d === undefined) return '';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d;
  return d.dice + 'd' + d.sides + (d.bonus ? (d.bonus > 0 ? '+' : '') + d.bonus : '');
}

const STAT_NAME = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

export function itemEffectLines(it) {
  const fx = (it && it.effects) || {};
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
  if (fx.heal) out.push('mends ' + dieText(fx.heal) + ' hp');
  if (fx.power) out.push('restores ' + dieText(fx.power) + ' power');
  if (fx.regen) out.push('mends ' + fx.regen + ' hp a turn');
  if (fx.resist) out.push('soaks ' + fx.resist + ' damage from every blow');
  if (fx.undeadResist) out.push('soaks ' + fx.undeadResist + ' more from undead and cursed things');
  if (fx.luck) out.push('a second look at ' + Math.round(Math.min(0.6, fx.luck * 0.15) * 100) + '% of the blows you miss with');
  if (fx.seeSecrets) out.push('shows secret doors');
  if (fx.spell) out.push('casts ' + fx.spell);
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

export function itemDescription(it) {
  if (!it) return '';
  const lines = itemEffectLines(it);
  /* Treasure does nothing but be worth something, which is worth saying. */
  if (!lines.length && it.kind === 'special') lines.push('worth ' + (it.value || 0) + ' gp to the right buyer');
  if (it.cursed) lines.push('cursed — it will not come off');
  if (!lines.length) return '';
  return lines.join(' · ');
}

