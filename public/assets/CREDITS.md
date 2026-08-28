# Art credits

Everything under `public/assets/` is third-party open-licensed art. Nothing in
this directory was made for this game; all of it was made by the artists below
and released under licences that allow redistribution. This file is the record
of who made what and what each licence requires. If a directory is not listed
here, it should not exist.

## tilesets/ — Flare (fantasycore), CC-BY-SA 3.0

Prerendered isometric tile atlases from the [Flare
project](https://github.com/flareteam/flare-game) (`mods/fantasycore`), at
full resolution (64×32 base tile). The `defs/` folder carries Flare's own
tileset definitions — `tile=id,x,y,w,h,offset_x,offset_y` rows mapping tile
ids to atlas rectangles.

- **Artist:** Clint Bellanger (https://clintbellanger.net), with the Flare
  art contributors listed in [FLARE-CREDITS.txt](../assets/FLARE-CREDITS.txt)
- **Licence:** [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- **Source:** https://github.com/flareteam/flare-game
- **Obligations:** credit the artists (this file), and any redistribution of
  the art — including modified copies — stays under CC-BY-SA.

## creatures/ — Flare (fantasycore, empyrean_campaign, minicore), CC-BY-SA 3.0

Eight-direction creature sprite sheets from Flare, at full `mods/fantasycore`
resolution — about six times the linear detail of the half-scale `minicore`
renders these started as, which turned to mush the moment this renderer let
the player zoom in. `wyvern_adult` (the Great Wyrm) comes from
`mods/empyrean_campaign`; `stealth` is still minicore's, because no larger
copy of it exists in any mod.

**These sheets are modified copies.** `scripts/repack-flare-art.mjs` cuts the
`[stance]` frames out of the upstream sheets and packs them into a smaller
one, discarding the nine animations this game never draws, and scales what is
left to the largest size the renderer can put on screen — 170MB of upstream
art reduced to 26MB with no loss visible at any zoom this game offers. No
pixel is painted, redrawn or invented; every one that survives is the
artist's own. `defs/` holds the rewritten animation definitions, in Flare's
own format plus one line of ours (`scale=`, recording how much bigger the art
is than the sizing it replaced, so creatures keep the size they had).

- **Artists:** Clint Bellanger, Justin Jacobs, and the Flare art contributors
  (see [FLARE-CREDITS.txt](../assets/FLARE-CREDITS.txt))
- **Licence:** [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- **Source:** https://github.com/flareteam/flare-game
- **Obligations:** credit the artists (this file); the modified copies here
  stay under CC-BY-SA, as ShareAlike requires.

## hero/ — Flare (minicore), CC-BY-SA 3.0

The modular hero: `male/` and `female/` each hold ~58 paper-doll layers
(bodies, heads, cloth/leather/chain/plate/mage gear, and weapons from dagger
to greatsword), each an 8-direction sheet aligned to the same frame grid, so
equipped gear can be drawn visibly on the character, ToEE-style. `defs/`
holds the per-layer animation definitions.

- **Artists:** Clint Bellanger and the Flare art contributors
- **Licence:** [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- **Source:** https://github.com/flareteam/flare-game

## icons/ — Flare (fantasycore), CC-BY-SA 3.0

`icons.png` / `icons_overlay.png`: the item-icon atlases (32×32 grid), for
inventory and belt art.

- **Artists:** Clint Bellanger, Justin Nichol, and the Flare art contributors
- **Licence:** [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- **Source:** https://github.com/flareteam/flare-game

## tilesets/medieval_building_tiles.png — Clint Bellanger, CC-BY-SA 3.0

Sixty isometric medieval building tiles — timber frame, wattle, red tile
roofs — on the same 64×32 base as the rest of the Flare art, made for
OSARE (Flare's predecessor). The roof texture is from the public-domain
Blender Texture CD; the stone texture is "Old Brick Wall" by Sindwiller.
The grid definition in `defs/medieval_building_tiles.txt` is generated,
not the artist's.

- **Artist:** Clint Bellanger (https://clintbellanger.net)
- **Licence:** [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
  (also offered under GPL 2.0/3.0)
- **Source:** https://opengameart.org/content/medieval-building-tiles

## portraits/flare/ — Flare (fantasycore), CC-BY-SA 3.0

Painted character portraits from Flare.

- **Artist:** Justin Nichol (https://opengameart.org/users/justin-nichol)
  and the Flare art contributors
- **Licence:** [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- **Source:** https://github.com/flareteam/flare-game

## portraits/pd/ — public-domain paintings, CC0

82 portraits at 200×200, cropped by Iwan "qubodup" Gabovitch from paintings
old enough to have no copyright left to waive — the file names name the
original painters.

- **Compiled by:** Iwan "qubodup" Gabovitch
- **Licence:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
  (the underlying paintings are public domain)
- **Source:** https://opengameart.org/content/200-cc0-portraits-of-humans-from-public-domain-paintings

## props/kenney/ — Kenney Dungeon Pack, CC0

288 prerendered isometric dungeon pieces (walls, floors, doors, barrels,
chests, bridges, stairs), each in four facings (`_N/_S/_E/_W`). From
Kenney's "Isometric Miniature Dungeon" (Dungeon Pack 2.3).

- **Artist:** Kenney (https://kenney.nl)
- **Licence:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
  (see [LICENSE.txt](props/kenney/LICENSE.txt)); attribution appreciated,
  not required — given gladly here.
- **Source:** https://kenney.nl/assets/isometric-miniature-dungeon
