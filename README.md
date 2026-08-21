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

`action` is one of `dungeon | monster | item | ability`. `context.focus` steers the theme;
for `ability` the player's current class is passed automatically.

Example:

```sh
curl -sX POST http://localhost:8080/api/expand \
  -H 'Content-Type: application/json' \
  -d '{"action":"monster","context":{"focus":"a chitinous horror"} }'
```

## Project layout

```
server.js           HTTP server, static serving, LLM proxy & expansion generator
public/index.html   Single-page shell
public/style.css    Layout & theming
public/js/
  base.js           Rules/data: classes, abilities, themes, item templates, XP table
  dice.js           rpg-style dice helpers
  rng.js            seedable RNG
  mapgen.js         Room-corridor dungeon generation
  npc.js            NPC/monster templates
  world.js          World map + dungeon registry
  engine.js         Game state machine: movement, combat, inventory, abilities, save
  main.js           UI controller: canvas renderer, HUD, panels, keyboard, save/load, library
data/expansions.json  Persisted generated content (server-side)
```

## Controls

| Key | Action |
| --- | ------ |
| `WASD` / arrow keys | Move |
| `G` | Pick up items under you |
| `Space` / `X` | End your turn (wait) |
| `1`–`9` | Activate the matching ability |
| `Tab` | Cycle panels (stats / gear / codex / library) |
| `I` / `E` | Gear & inventory panel |
| `C` | Codex panel |
| `L` | Library (expansions) panel |
| `Enter` | Start the game / send a dialogue line |
| `Esc` | Close the active dialogue |
