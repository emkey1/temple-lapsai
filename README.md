# Temple of Lapsai — Turn-Based Homage

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

The game ships with a small set of hand-authored expansions in `data/expansions.json`. With an LLM
API key configured, the "Library" tab can generate new dungeons, monsters, items, and abilities on
demand and append them to `data/expansions.json`.

### Configuration

Configure via environment variables:

```sh
OPENAI_API_KEY=sk-... \
OPENAI_BASE_URL=https://api.openai.com/v1 \
OPENAI_MODEL=gpt-4o-mini \
node server.js
```

Or drop a `config.json` in the project root (environment variables take precedence):

```json
{
  "openai": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini"
  }
}
```

Any OpenAI-compatible endpoint works (`OpenAI-Base-URL`, vLLM, local llama.cpp, etc.).

## HTTP API

| Method | Path            | Description                                                         |
| ------ | --------------- | ------------------------------------------------------------------- |
| GET    | `/api/status`   | `{ ok, llmConfigured, model, baseUrl, expansions }`                 |
| GET    | `/api/health`   | alias of `/api/status`                                              |
| GET    | `/api/expansions`| JSON array of all installed expansions                              |
| POST   | `/api/expand`   | Generate an expansion. Returns `201 { ok, expansion }`. `503` if no key configured. |

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
npm test
```

Runs the headless suite on `node:test` — no dependencies, no build. The engine has no DOM
dependencies, so the whole game runs in Node; the tests generate floors across many seeds and
assert the invariants that are invisible by inspection: every dungeon's monster and boss ids
resolve, every floor is fully reachable from its entrance, the boss is never sealed in its den,
monsters route around walls, aggro lapses, and floor state survives a save round-trip.

## Project layout

```
server.js           HTTP server, static serving, LLM proxy
lib/expansion.js    Prompt building and validation of everything the oracle returns
public/index.html   Single-page shell
public/style.css    Layout & theming
public/js/
  contract.js       THE CONTENT CONTRACT — one vocabulary shared by client and server
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
| `G` | Take what is underfoot — or, with nothing there, look around and see what lies within reach |
| `Space` / `X` | End your turn (wait) |
| `1`–`9` | Activate the matching ability |
| `Tab` | Cycle panels (stats / gear / codex / library) |
| `I` / `E` | Gear & inventory panel |
| `C` | Codex panel |
| `L` | Library (expansions) panel |
| `Enter` | Start the game / send a dialogue line |
| `Esc` | Close the active dialogue or the controls card |
| `?` / `H` | Show the controls in-game |
