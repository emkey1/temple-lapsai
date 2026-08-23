# Temple Lapsai — Turn-Based Homage

A zero-dependency, retro top-down turn-based dungeon crawler inspired by the 1982 classic, with
optional LLM-driven world expansion. Client and server are plain ES modules — no build step, no
npm install required.

## Requirements

- Node.js **>= 18** (uses global `fetch`, `URL`, top-level await)

## Running

```sh
npm start
# or directly:
node server.js
```

Serve yourself at http://localhost:8080. Port overrides via `PORT`.

The game runs entirely in the browser. Character sheet, inventory, codex, library, and dungeon
generation are all client-side; progression is saved to `localStorage`.

## LLM-driven expansion (optional)

`data/expansions.json` starts empty. With an LLM API key configured, the "Library" tab generates new
dungeons, monsters, items and abilities on demand, validates them, and appends them to that file;
the client merges whatever is there into every new game on boot.

### Configuration

**From inside the game.** Open the Black Library (`L`, then OPEN THE BLACK LIBRARY) and unfold
THE ORACLE. Pick a provider, paste a key, press BIND THE ORACLE, then TEST IT. Nothing needs a
restart. The choice is written to `config.json` (mode `600`, git-ignored); FORGET drops it again.

Providers are listed in `public/js/providers.js`, which both the menu and the server read — so the
menu cannot offer an endpoint the server has no dialect for:

| Provider | Dialect | Key |
| --- | --- | --- |
| OpenAI, Google Gemini, Groq, Mistral, OpenRouter | `/chat/completions` | yes |
| Anthropic | `/messages` | yes |
| Ollama, LM Studio | `/chat/completions` | no — they run on your machine |
| Custom endpoint | either | as you like |

**From the environment**, if you would rather not type a key into a web page:

```sh
OPENAI_API_KEY=sk-...  node server.js       # or ANTHROPIC_API_KEY
ORACLE_PROVIDER=groq ORACLE_API_KEY=gsk-... node server.js
```

`OPENAI_BASE_URL` / `OPENAI_MODEL` and `ORACLE_BASE_URL` / `ORACLE_MODEL` override the endpoint and
model. A `config.json` written from the menu wins over the environment — that is what FORGET is for.
The older `{"openai": {...}}` and flat `{"apiKey": ...}` shapes are still read.

## HTTP API

| Method | Path            | Description                                                         |
| ------ | --------------- | ------------------------------------------------------------------- |
| GET    | `/api/status`   | `{ ok, llmConfigured, provider, model, baseUrl, expansions }`       |
| GET    | `/api/health`   | alias of `/api/status`                                              |
| GET    | `/api/expansions`| JSON array of all installed expansions                              |
| POST   | `/api/expand`   | Generate an expansion. Returns `201 { ok, expansion }`. `503` if no oracle is bound. |
| GET    | `/api/oracle`   | The provider list, and which one is bound. Never returns the key — only its last four characters. |
| POST   | `/api/oracle`   | Bind one: `{ provider, model, baseUrl, apiKey }`. An empty `apiKey` keeps the stored one; `{ clearKey: true }` drops it; `{ reset: true }` forgets the saved settings entirely. |
| POST   | `/api/oracle/test` | One cheap call, to find out whether the key, the model name and the endpoint are real. |

`POST /api/expand` body:

```json
{
  "action": "dungeon",
  "context": { "focus": "a sunken fane of the serpent folk", "theme": "cavern" }
}
```

`action` is one of `dungeon | monster | item | ability`. `context.focus` is the creative
direction the player typed; `context.depth` pitches the result at a character of that level, and
`context.theme`, `context.cls` and `context.existing` are filled in from the current game.

Generated content is validated field by field against `public/js/contract.js` — the same
vocabulary the client renders with, and the same one the prompt's enum lists are generated from,
so what the model is offered and what the game will accept cannot drift apart. Anything that
survives validation is playable: items join the loot tables banded by tier, abilities appear on
the ability bar for the right class at the right level, monsters keep their behaviour, and
dungeons take their place in the codex once the Temple has been cleared.

Example:

```sh
curl -sX POST http://localhost:8080/api/expand \
  -H 'Content-Type: application/json' \
  -d '{"action":"monster","context":{"focus":"a chitinous horror"} }'
```

## Delving

A few rules worth knowing before you go down:

- **Secret doors** are walls until you find them. Walk into a suspicious wall to search it — thieves
  are much better at this, and an Amulet of True Seeing skips the roll entirely.
- **Water** is crossable, but wading costs the turn twice over and the splashing wakes anything
  within six tiles.
- **Floors remember you.** What you killed stays dead, what you took stays taken, doors you opened
  stay open, and the map you drew stays drawn — across stairs, saves and reloads.
- **Wounds close and power returns** while nothing awake is near you, slowly. Retreating out of
  a fight is a tactic, not a longer death. `R` sits you down until you are whole.
- **Every character walks a different dungeon.** Floors are seeded from the character, not from
  the dungeon's name.
- **Altars** stand once on every floor. Step onto one for a blessing — health, power, and any
  curse lifted. Each gives once, and will not spend itself on someone who needs nothing.
- **The belt** takes four items. Bind with BELT in the gear panel, use with **shift + 1-4**.
- **Armour class descends**, as in the modules this is an homage to: lower is harder to hit.
- The stairs down are only barred while something is at your heels.

## The writing

The world — five eras of history, seven factions, a story arc per dungeon and a speaking cast —
lives in `public/js/lore.js`. It is content only, no logic, so it can be edited by anyone who can
count commas; `world.js` registers it on import and the engine reads it through the queries there.

Story beats fire at `(dungeonId, kind, floorIdx)`. `kind` is `enter` (arriving on a floor), `boss`,
`finish` (the dungeon cleared) or `condition` (a level-up); `type` is `narration` for a line in the
message log, `overlay` for a full card, or `flag` for bookkeeping. Floors are zero-based, and a beat
fires once per character.

Dialogue topics are matched as substrings against what the player types and the **first** match
wins — so a topic carrying a short common key (`god`, `door`) must sit below the specific topics it
would otherwise swallow. `npm test` checks that no topic is unreachable.

## Development

```sh
npm run check     # lint, then the test suite
npm test
npm run lint
```

`npm test` runs the headless suite on `node:test` — no dependencies, no build. The engine has no DOM
dependencies, so the whole game runs in Node; the tests generate floors across many seeds and
assert the invariants that are invisible by inspection: every dungeon's monster and boss ids
resolve, every floor is fully reachable from its entrance, the boss is never sealed in its den,
monsters route around walls, aggro lapses, and floor state survives a save round-trip. It also
checks the written world: that no dialogue topic is unreachable behind an earlier keyword, and that
no NPC recites a story beat the player is about to read.

`npm run lint` is a dependency-free check — every file parses, every relative import resolves, no
debug debris, and the two conventions the content depends on.

The server binds to `127.0.0.1` by default; set `HOST=0.0.0.0` if you deliberately want it on the
network. `POST /api/expand` refuses cross-origin requests and is rate-limited, because it spends
your API key.

## Project layout

```
server.js           HTTP server, static serving, LLM proxy
lib/expansion.js    Prompt building and validation of everything the oracle returns
lib/oracle.js       Which model answers the Library, and how to reach it
public/index.html   Single-page shell
public/style.css    Layout & theming
public/js/
  contract.js       THE CONTENT CONTRACT — one vocabulary shared by client and server
  providers.js      THE PROVIDER LIST — the oracle menu and the server read the same file
  describe.js       Turns an item's effects into the line of rules text under its name
  base.js           Rules/data: classes, abilities, themes, item templates, XP table
  dice.js           rpg-style dice helpers
  rng.js            seedable RNG
  mapgen.js         Room-corridor dungeon generation
  npc.js            Dialogue machinery (keyword topics, pluggable LLM adapter)
  lore.js           THE WRITING — history, factions, story arcs, the cast and their dialogue
  world.js          World layer: registers the lore and answers the engine's queries about it
  engine.js         Game state machine: movement, combat, inventory, abilities, save
  main.js           UI controller: canvas renderer, HUD, panels, keyboard, save/load, library
data/expansions.json  Persisted generated content (server-side)
```

## Controls

| Key | Action |
| --- | ------ |
| `WASD` / arrow keys | Move |
| `Y` `U` `B` `N` / numpad | Move diagonally (numpad `5` waits) |
| `G` | Take what is underfoot — or, with nothing there, look around and see what lies within reach |
| `Space` / `X` | End your turn (wait) |
| `R` | Rest until healed, or until something wakes |
| `1`–`9` | Activate the matching ability |
| `Tab` | Cycle panels (stats / gear / codex / library) |
| `I` / `E` | Gear & inventory panel |
| `C` | Codex panel |
| `L` | Library (expansions) panel |
| `Enter` | Start the game / send a dialogue line |
| `Esc` | Close the active dialogue or the controls card |
| `?` / `H` | Show the controls in-game |

### Healing

A burst heal mends **at least a share of your maximum health** — a quarter for a
Potion of Healing, half for Superior Healing, a fifth per charge of a Wand of Healing, a third
for the Cleric's Lay on Hands, half for the Fighter's Second Wind. The roll still stands whenever
it is larger, so nothing heals for less than it used to and level 1 plays exactly as it did.

The reason is arithmetic. Flat dice do not scale and everything around them does: 2d4+2 is a third
of a level-1 character and a twelfth of a level-12 one, while the thing hitting them grew the whole
way. Beside the Demon of Lapsai a Potion of Healing gave back 7 and the turn it cost gave away 14,
so drinking one left you **worse off in 97 runs out of 100** — the potion was never broken, the turn
was. The altar (35% of max) and out-of-combat regeneration already worked this way; this is the same
idea reaching the things you carry.

Every item and power prints what it will actually mend, resolved against your own health, so the
card and the engine cannot disagree.

### Bosses

A boss is exactly the creature on its card, scaled by depth like everything
else. It used to be given a silent **4x hit points** on top of that, on top of a
card that was already the biggest in the bestiary: the Demon of Lapsai arrived
with **1,129 hit points** — twenty-two times the toughest ordinary monster
standing on the same floor — against a level 6 character dealing about two
damage a turn. Measured over 720 duels, every class, every level up to 15, in
the best kit the game can hand you: nobody ever won, once.

Measured now, 60 duels a cell, in the kit each dungeon can supply:

| boss | at level | fighter | thief | cleric |
| --- | --- | --- | --- | --- |
| Demon of Lapsai (Temple) | 5 / 6 / 7 | 57% / 60% / 98% | 82% / 78% / 98% | 40% / 38% / 88% |
| Umber Hulk (Upper Reaches) | 8 / 9 / 10 | 67% / 72% / 93% | 55% / 75% / 90% | 43% / 37% / 55% |
| Great Wyrm (Serpent) | 11 / 12 / 13 | 32% / 30% / 82% | 55% / 43% / 85% | 8% / 12% / 53% |

Each boss is a real fight that levelling wins. The Mage is the known gap — its
power is a fixed pool, and once it is spent the Mage is swinging a stick.

### Saved adventurers

The game keeps a **ledger**: one record per adventurer, not one save for the whole game. Rolling
someone new used to write over whoever went down last.

- **CONTINUE** opens the one you played last.
- **OTHER ADVENTURERS** opens the ledger — everyone you have sent down, with where they got to,
  what they are carrying and when they were last saved. Play any of them, or erase one (which asks
  twice).
- A character who dies is marked **fallen** on the ledger rather than in their own record, because
  the record is deliberately not written on the killing blow. Opening a fallen adventurer raises
  them at the same price the death card charges — half their gold — so a second character is never
  a way to dodge the cost of dying.
- An existing single save is adopted as the first name in the ledger the next time the game loads.

Storage lives in `public/js/roster.js` and takes its store as an argument, so all of it is covered
by tests rather than by clicking around in a browser.

### The Mage

No Vancian pool. **Ebb & Flow** (level 1, passive) makes the reserve a tide rather than a cup: while
a fight is on it seeps back a little each turn, and a blow landed with a **staff — a weapon that
carries power, which a sword does not** — draws deeper. So the turn you spend in reach is how you
buy the next Firebolt, and the mundane swing stops being the thing you do *instead* of being a Mage.
**Witch-Spark** (at will, 1d4 at six paces, costs nothing) means a dry turn is still a spell.
**Ashen Mantle** (level 3) turns damage aside for six turns, because frailty was the other half of
why a Mage could not finish a fight.

The renewal is deliberately not something the oracle may write: a Fighter with in-combat power
renewal casts Second Wind, which mends half its maximum health, without limit.

And every ability in the game now grows with practice. They were flat dice forever: a level 12
Firebolt was the same 1d8+INT as a level 1 one, while a fighter's damage grew with the weapon, the
strength and the level. That is why the Mage measured as the *weakest* attacker at depth despite
owning the only attack that cannot miss.

Boss win rates before and after, 60 duels a cell:

| | Temple | Upper Reaches | Serpent |
| --- | --- | --- | --- |
| before | 13% | 0% | 0% |
| after | 65–100% | 22–87% | 2–58% |
| fighter, for scale | 65–95% | 65–95% | 63–97% |

In the pack at the Temple, real but weaker deeper, and never once reduced to carrying the luggage.
Witch-Spark used to hand a point of power back too; measured, a Mage with both economies won 92% of
the first boss fight against a Fighter's 77%, so the spark is the action and Ebb & Flow is the whole
of the economy.

### Experience

`gainXP` subtracts as it goes, so reaching level N costs the sum of every step below it — which made
the old curve far steeper than it read. Measured against what the generator actually puts on the
floors, clearing the whole of Temple floor one paid **106** against the **150** level two cost, so a
player finished the first floor of the game still at level one. The curve now matches the content:
level two arrives partway through floor one, a full Temple leaves you at six, the whole game reaches
twelve — and each boss is met at the level it was tuned against (5, 8 and 12).

### Reading the map

Colour is not decoration. Everything alive is drawn in the red family, tinted by tier — dull rust
for vermin, deep red and bright red as it gets worse, ember and a searing pale for the things at the
bottom. Nothing you can pick up is ever red, and nothing but you is drawn `@`.
