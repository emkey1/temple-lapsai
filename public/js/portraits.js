/* THE FACES: every portrait the repo carries, listed by hand-generated
 * manifest because a browser cannot ask a directory what it holds. The
 * Flare faces (CC-BY-SA, see assets/CREDITS.md) wear the game's own
 * fantasy style and portray the company, matched to the paper doll's
 * body; the public-domain paintings (CC0, cropped by qubodup) portray
 * everyone else — keepers, strangers, the people of the Whetstone.
 *
 * The painted pool was classified BY LOOKING at all eighty-two, after
 * the ferrier's widow drew a magnificent beard from the unsorted hash.
 * The ambiguous few serve either. Assignment stays a stable hash of the
 * name: the same name is the same face for ever, on any machine. */

export const FLARE_PORTRAITS = {
  male: [
  'male01.png',
  'male02.png',
  'male03.png',
  'male04.png',
  'male05.png',
  'male06.png',
  'male07.png',
  'male08.png',
  'male09.png',
  'male10.png',
  'male11.png',
  'male12.png',
  'male13.png',
  'male14.png',
  'male15.png',
  'male16.png',
  'male17.png',
  'male18.png',
  'male19.png',
  'male20.png',
  ],
  female: [
  'female01.png',
  'female02.png',
  'female03.png',
  'female04.png',
  'female05.png',
  'female06.png',
  'female07.png',
  'female08.png',
  'female09.png',
  'female10.png',
  'female11.png',
  'female12.png',
  'female13.png',
  'female14.png',
  'female15.png',
  ],
};

export const PD_PORTRAITS = {
  male: [
  'adelaide_hanscom1.png',
  'alexey_petrovich_antropov1.png',
  'antonio_herrera_toro1.png',
  'cristobal_rojas1.png',
  'domenikos_theotokopoulos1.png',
  'edmund_blair_leighton2.png',
  'felix_bonfils1.png',
  'francesco_hayez1.png',
  'francisco_zurbaran1.png',
  'frederic_westin1.png',
  'giovanni_battista_tiepolo1.png',
  'giovanni_bellini1.png',
  'hayez_francesco1.png',
  'ilja_jefimowitsch_repin1.png',
  'jean-leon_gerome2.png',
  'jean-leon_gerome3.png',
  'jean-leon_gerome4.png',
  'julije_klovic1.png',
  'juriaen_streek1.png',
  'moritz_kellerhoven1.png',
  'nathaniel_jocelyn1.png',
  'nikolai_alexandrowitsch_jaroschenko1.png',
  'nils_johan_olsson_blommer1.png',
  'paolo_veronese1.png',
  'richard_bergh1.png',
  'richard_bergh2.png',
  'viktor_vasnetsov1.png',
  ],
  female: [
  'alessandro_allori1.png',
  'alessandro_allori2.png',
  'alexandre_cabanel1.png',
  'alexei_harlamov1.png',
  'aman_theodor1.png',
  'antonello_messina1.png',
  'benjamin-constant1.png',
  'benoist_marie-guillemine1.png',
  'bouguereau_william-adolphe1.png',
  'byron1.png',
  'carl_fredric_breda1.png',
  'carl_fredric_breda2.png',
  'cramacj_lucas1.png',
  'cranach_lucas2.png',
  'delacroix_eugene_ferdinand_victor1.png',
  'edmund_blair_leighton1.png',
  'edwin_longsden_long1.png',
  'falero_luis_ricardo1.png',
  'francisco_goya_lucientes1.png',
  'francisco_goya_lucientes2.png',
  'franz_von_defregger2.png',
  'franz_von_defregger3.png',
  'frederic_yates1.png',
  'frederick_leighton1.png',
  'gaston_bussiere1.png',
  'george_henry_hall1.png',
  'hans_holbein1.png',
  'james_carrol_beckwith1.png',
  'jean-baptiste-camille_corot1.png',
  'jean-baptiste-camille_corot2.png',
  'jean-leon_gerome1.png',
  'john_william_godward1.png',
  'john_william_godward2.png',
  'john_william_godward3.png',
  'kiprenskij_orest_adamovic1.png',
  'konstantin_makovsky1.png',
  'lefebvre_jules_joseph1.png',
  'leon-francois_comerre1.png',
  'leopold_loffler1.png',
  'lewis_john_frederick1.png',
  'madrazo_garreta_raimundo1.png',
  'marie_bashkirtseff1.png',
  'parmigianino1.png',
  'paul_cesar_helleu1.png',
  'robert_lefevre1.png',
  'robert_leopold1.png',
  'sichel_nathanael1.png',
  'svetoslav_roerich1.png',
  'velazquez_diego1.png',
  'william-adolphe_bouguereau1.png',
  ],
  either: [
  'alice_pike_barney1.png',
  'franz_von_defregger1.png',
  'henryk_siemiradzki1.png',
  'regnault_henri1.png',
  'robert_dampier1.png',
  ],
};

function hashName(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/* A member's face: from the Flare set, matched to the same name-hash sex
 * the paper doll uses (see heroSex in main.js — the two must agree). */
export function memberPortrait(name, sex) {
  const pool = FLARE_PORTRAITS[sex === 'female' ? 'female' : 'male'];
  return 'assets/portraits/flare/' + pool[hashName(name) % pool.length];
}

/* Everyone else: a painting old enough to have outlived its sitter,
 * drawn from the pool their stated sex allows — widows do not draw
 * beards any more. No stated sex draws from the whole gallery. */
export function npcPortrait(id, sex) {
  const P = PD_PORTRAITS;
  const pool = sex === 'female' ? [...P.female, ...P.either]
    : sex === 'male' ? [...P.male, ...P.either]
    : [...P.male, ...P.female, ...P.either];
  return 'assets/portraits/pd/' + pool[hashName(id) % pool.length];
}
