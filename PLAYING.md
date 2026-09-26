# Playing Temple Lapsai

You are a company of adventurers, not a hero. You go down under a broken
lintel into the Temple of Lapsai for the oldest reason there is — something
down there is owed, and somebody has to collect — and you come back up to a
flat stone called the Whetstone to spend what you hauled out of the dark.
Nothing down there stays dead that is worth gold, and nothing you carry is
worth anything until you get it back to the light.

This is the player's manual. If you want to know how the thing is built, read
[README.md](README.md); if you just want to survive the first hour, read on.

---

## Running it

```sh
node server.js
```

Then open **http://localhost:8080**. That is the whole install — no build step,
no `npm install`, no bundler. The game is plain ES modules in the browser and a
small server that optionally talks to an LLM for extra content.

## The first hour

1. **Make an adventurer.** Pick a class (fighter, thief, mage, cleric), a
   background, and a name. Roll the stats until you like them.
2. **Go down.** The Temple's mouth is the first stair in the Whetstone's east
   field. Each dungeon is four floors; the boss is at the bottom.
3. **Fight and loot.** Everything hostile is drawn in red; loot is drawn in a
   palette with no red in it. Take what you can carry.
4. **Come back up.** The stairs up lead to the Whetstone. Sell your haul, buy
   what you need, rest, and go back down.
5. **Clear a sanctum** by killing its boss. Three sanctums open the way to the
   end of the founding chronicle.

That loop — descend, haul, sell, rest, descend — is the whole game. Everything
else is a way to do it better.

## Controls

The keyboard does everything; the mouse is for pointing at the world.

| Key | What it does |
| --- | --- |
| **Arrow keys** / **WASD** / **numpad** | Move a step (eight directions) |
| **Numpad 1–9** | Move and strike a diagonal in one turn |
| **`g`** | Take what is under you, or look |
| **`r`** | Rest a turn (slowly mends, out of combat) |
| **`1`–`9`** | Use the ability in that slot |
| **Shift + `1`–`4`** | Drink from your belt |
| **`i`** / **`e`** | The Gear panel (equipment, pack, belt) |
| **`c`** | The Codex (undertakings, journal, depths, chronicle, powers) |
| **`l`** | The Black Library (optional generated content) |
| **`m`** | The region map — where you are, and the roads out of it |
| **`Tab`** | Cycle the side panels |
| **`v`** | Toggle the view — isometric scene ⟷ classic square grid |
| **`+`** / **`-`** | Lean in or out of the scene (mouse wheel works too) |
| **`?`** or **`h`** | The key list |
| **Hold a direction** | Walk (the autopilot follows a path) |
| **Esc** | Close a card |

## Your company

You can lead up to **four**. Hire swords at the Whetstone's muster; they arrive
at your own level, armed and dressed for it. Every member is a full character —
their own class, background, skills, pack and gear.

- **Classes** bring an ability ladder each: the fighter's cleave and steel, the
  thief's shadows and backstab, the mage's seven schools of harm, the cleric's
  mending and malediction.
- **Backgrounds** are who you were before: nine of them, each nudging your
  stats and giving a perk (resistance, a skill, a purse that starts heavier).
- **Skills** are practiced, not chosen: fieldcraft finds seams, lore reads
  runes, haggle bends prices, and so on.

The company shares one **purse**, one **standing** with the powers of the
world, and one **ledger of undertakings**. A favour owed to the woman who
carried the idols is not owed to her alone.

## The Whetstone

The town at the top of the stairs, where gold finally means something:

- **The Provisioner** buys what you haul up and sells the consumables the
  dungeon is stingy with.
- **The Lector** reads runes (identifies an item) and unbinds curses, for coin.
- **The Muster** hires companions at your level.
- **The Drowned Lantern** beds the whole company for a night: everyone wakes
  healed, rested and cooled down. The only fast way to close wounds.
- **The Little Temple** raises one fallen companion for coin — dearer the more
  seasoned they were, and never haggled.

## The region

Press **`m`** to see the world from above: the Whetstone at the foot of the
hill, the stairs down to each sanctum, and the names the stories keep — the
Chute, the Far Reach, the Drowned Quarter. **You are here** is marked. Click a
place you have found and the company takes the road there, so you need never
walk the green to reach a mouth again. The rest are not roads yet; they wait to
be found.

## Fighting

Combat is turn-based and positional, after the old tabletop games:

- **A turn is a step and a blow.** You can move and strike; the order is yours.
- **Attacks of opportunity.** Walk away from something that is in reach and it
  gets a free swing. Kill it or disengage; do not stroll.
- **Flanking.** Strike a foe with an ally on its far side and you hit easier.
- **Initiative** is rolled and shown; quick things act before slow ones, but
  nothing strikes twice in one turn.
- **Water** is slow and loud. Wade in and everything nearby hears it.
- **Altars** are one-shot: they close wounds the rest cannot reach, mend you,
  and unbind what has hold of you — once per character, per altar.
- **Abilities** cost power and run on cooldowns. A spent caster without power
  is a person with a stick; manage it.

## Undertakings

People want things, and if you do them a favour they remember it. Walk up to
someone and their ask sits in the dialogue card: **TAKE IT ON**, and later
**HAND IT OVER**. The Codex's **Undertakings** lists what you owe.

Closing an undertaking earns your **company's standing** with the order behind
it. Standing is not a number that does nothing: the Carriers pay above scrap,
the Sisters name the safe channels, the Keepers hold the survey open, the
Tallymen bend their haul-back rate, the Drain Toll's crews let a customer walk,
the garrison knows its own, and the Archive names what you lift. The
**Powers of the World** page in the Codex says where you stand and what it has
bought.

## Dying

You will die. When the company falls, the temple scribes haul you back from the
threshold for **half your gold** — the standing rate, which friendship bends
but never waives. You wake at camp on the lintel, wounds mended, ready to try
again. Losing is expensive, not final.

## The Black Library (optional)

With an LLM key configured, the **Library** tab writes new dungeons, monsters,
items and abilities on demand and folds them into the world. It is entirely
optional: the game is complete without it, and runs offline with the founding
three sanctums forever. Setup is in the [README](README.md#llm-driven-expansion-optional).

**And the people can speak.** Bind an oracle and the characters you meet answer
in their own voice — leave it unbound and they fall back to their written lines.

## Saving

Your adventurer saves itself as you play. **CONTINUE** on the title card picks
up where you left off; **OTHER ADVENTURERS** manages multiple companies. What
the Library writes belongs to your save, not to the repo — so commission freely.

## A few things worth knowing

- **Hunger is not a mechanic, but greed is.** The pack is limited; sell often.
- **Unread items lie.** A cheap blade might be cursed. The Lector can tell you
  for a fee — or a blacksmith's mistake can tell you for free.
- **The boss is at the bottom, and the bottom is four floors down.** Come back
  up before you are out of potions, not after.
- **Nothing respawns.** The dungeon remembers what you killed. Clear it, and it
  stays cleared — which is a resource as much as a risk.
