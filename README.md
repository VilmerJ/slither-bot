# Slither.io bot

A Node.js bot that opens a real browser, joins Slither.io, observes the client state, and controls the snake with mouse input. The default AI chooses a uniformly random heading every 200 ms. It automatically starts another round after dying and closes its browser when stopped.

## Run

Requires Node.js 22 or newer and network access to Slither.io and its game servers.

```sh
npm ci
npm run setup
npm start
```

`npm run setup` installs Playwright's Chromium. The bot uses that browser when installed, otherwise it tries installed Google Chrome. Force Chrome with `npm start -- --channel chrome`. A dedicated browser/profile is created for each run; your existing browser session is not used.

```sh
# Watch the random policy play; Ctrl+C stops it.
npm start

# Run for 60 seconds without a window, saving every observation/action.
npm start -- --headless --duration 60 --record --screenshot

# Switch policies without changing browser or game code.
npm start -- --ai forager
npm start -- --ai ./examples/center.js

# All options.
npm start -- --help
```

The game keeps running between decisions. A 200 ms tick means five decisions per second, not one game simulation step. The random policy has no collision avoidance, never boosts, and may die quickly or turn in circles. The `forager` example follows nearby food and turns inward near the arena edge; it does not avoid snakes either. A seed reproduces policy randomness, not the multiplayer environment.

## Play with Monte Carlo tree search

```sh
# Local search, with no model API calls or API key required.
npm run start:mcts

# Save a bounded run and its search diagnostics.
npm run start:mcts -- --headless --duration 60 --record --screenshot --output artifacts/mcts

# Optional search tuning.
npm run start:mcts -- --ai-config examples/mcts.json
```

MCTS builds a new search tree from each observation. It uses [UCT selection, expansion, random rollouts, and backpropagation](https://cs.brown.edu/people/gdk/pubs/analysis_mcts.pdf) to compare sequences of moves. The default budget is 40 ms or 1,500 iterations, whichever comes first. Each rollout looks ten moves ahead; with the default 200 ms tick, that is a two-second horizon. The controller executes the most visited first move, then replans from the next real observation. First moves predicted to collide immediately are excluded when any surviving alternative exists.

The five actions are straight, left/right 30°, and left/right 90°, relative to the simulated heading. This policy always uses normal speed. The local simulator limits turning speed, sweeps the head along each short movement segment to detect collisions, estimates food pickup, and prevents collecting the same food twice. Surviving earns more than any fatal rollout; food, clearance, and smooth turning distinguish surviving paths. A spatial index keeps collision queries local while still including long enemy body segments crossing the reachable area.

Movement uses the inspected client's nominal equations: `speed × elapsedMs / 32` for travel, and the observed `turnRate` for rotation. Older recordings without `turnRate` use the client's default turn constant and size adjustment. Opponent bodies remain fixed during a rollout, and heads extend straight trails at their observed speeds with a growing uncertainty margin. Tails disappearing, opponent turns, spawning food, moving prey, network lag, and the server's exact collision rules are not simulated. Unknown distant entities remain unknown. This is approximate local planning, so a promising rollout does not guarantee survival in the live game.

`examples/mcts.json` exposes `budgetMs`, `maxIterations`, `depth`, `exploration`, `safetyMargin`, and `maxDecisionAgeMs`. `stepMs` may also be set; otherwise it follows `--tick-ms`. The search budget is a soft deadline checked between iterations, and all five first moves are explored at least once. The existing worker deadline provides a hard stop if a policy call stalls. The default action freshness limit is 400 ms; stale results continue on the current heading without boost, and results for ended rounds are discarded.

Decisions record search time, iterations, tree size/depth, and each first move's visits and mean reward. `last-run.json` contains aggregate `search` statistics. The seed controls sampling; a time budget can change the iteration count with machine load, so it does not guarantee identical results. Set a small fixed `maxIterations` and enough `budgetMs` for reproducible offline comparisons.

## Play with Jev

Put your TypeSafe key in `.env` in this directory:

```dotenv
TYPESAFE_API_KEY=your-key-here
```

`.env` is git-ignored and loaded automatically; exported environment variables take precedence. `JEV_API_KEY` is also accepted when `TYPESAFE_API_KEY` is absent. The key stays in the Node.js worker and is sent only to the TypeSafe API, never to the game page or recordings.

```sh
# Watch Jev play continuously. Ctrl+C stops it.
npm run start:jev

# Bounded run with observations, decisions, and a final screenshot.
npm run start:jev -- --headless --duration 60 --record --screenshot --output artifacts/jev

# Optional tuning (defaults are shown in this file).
npm run start:jev -- --ai-config examples/jev.json
```

The loop is **observe → ask Jev → check freshness → steer → repeat**. Each request uses TypeSafe's [Choice API](https://docs.typesafe.ai/primitives/choice) with `jev-latest`. Jev selects one of ten directions relative to the current heading, with a boost variant for each when the snake is long enough. The browser controller executes that exact choice. There is one request in flight at a time, and each new request gets a new observation.

To keep input small, code computes obstacle clearances and food values for every candidate from all loaded live opponents and uneaten food. Jev also receives nearby snake, food, and arena summaries. The full observation still goes to the policy and, with `--record`, to disk. Jev does not receive screenshots, player names, or the full raw entity list. Clearances approximate straight paths against stationary bodies; actual turning and moving opponents can still cause collisions. This is an experimental playing policy, not a guarantee of good play.

The default 200 ms tick is a minimum interval. Actual speed includes API and browser latency; the game continues moving while Jev responds. Boost is released before each network call. Requests time out after 850 ms, and answers older than 1,000 ms are discarded. If an answer is late or a request fails, the bot continues along its **current** heading without boost and records the fallback explicitly. Answers are also discarded if the round ended while waiting. Rate limits honor `Retry-After`, transient failures back off, and eight consecutive failed requests stop the bot. Authentication and invalid-request errors stop immediately with a sanitized error.

`examples/jev.json` exposes `model`, `requestTimeoutMs`, `maxDecisionAgeMs`, `lookahead`, `allowBoost`, and `maxConsecutiveFailures`. A longer request timeout also requires raising `--ai-timeout-ms`; keep the request timeout at least 50 ms below that worker deadline. Each inference uses your API account. Reported token usage and latency are saved with decisions and in `last-run.json`; usage for timed-out requests may be unavailable locally.

## What the AI sees

Each decision receives a plain structured object, declared in [src/types.d.ts](src/types.d.ts):

| Field | Contents |
| --- | --- |
| `self` | Player ID/name, head position, heading, speed, body points, score, growth, boost request, skin, kills |
| `snakes` | Every currently loaded snake, including self, offscreen snakes, and flagged death animations |
| `food` | Every loaded food item, position, size, color, sector, and eaten/eater state |
| `prey` | Every loaded moving food creature, with heading, speed, position, and eaten/eater state |
| `arena` | Center, current radius, rendered radius, and sector dimensions |
| `minimap` | Global occupancy grid, dimensions, and row-major cells (`0` or `1`), or `null` before received |
| `camera` | World camera position, rendering scale, viewport scale, and viewport dimensions |
| `leaderboard`, `stats` | Leaderboard entries, rank, total players, and best rank |
| `coverage`, `client` | Explicit visibility limits, loaded food sectors, client version, and connection status |

**Exact whole-arena state is unavailable from the public game client.** The server streams nearby entities and removes entities as they leave its loaded region. The client may know hundreds of players exist while holding detailed data for only a few. The global minimap has anonymous occupancy, not IDs, names, or precise per-snake body data. Accordingly, `coverage.fullWorld` is always `false`; unobserved regions must be treated as unknown. No entities are invented, and old positions are not retained as though they were current. An exact global entity list would require server-side access or a server that explicitly supplies it.

All loaded entities are included, without screen clipping or truncation. `coverage.serverSectors` may be empty on the current protocol. `foodSectors` lists sectors containing known food; neither list proves all entities in those sectors are visible. Rank and player counts are `null` until the server supplies them. See [the coverage investigation](docs/coverage.md) for protocol and live-test evidence of the global-state limit.

Coordinates use world units, with positive x right and positive y down. Heading is clockwise radians: `0` right, `Math.PI / 2` down. `head` and body x/y are client simulation positions, which include client prediction; `renderHead`/`renderPosition` include interpolation offsets. Body points are in tail-to-neck order, with the head separate. Points with `dying: true` are fading from the tail and should not be treated as active body geometry. Dead snakes and eaten food/prey can remain briefly for animation; inspect their flags. Snake IDs may be reused between rounds, and the client can replace dead snake IDs with a shared sentinel; use live IDs only within the current episode. `visualRadius` is a renderer-derived size estimate, not a guaranteed server collision radius. `speed` is in client simulation units per frame, not units/second. `camera.scale` is world-to-canvas scale; `camera.viewportScale` accounts for CSS canvas scaling.

## Add an AI

Create an ES module default-exporting a policy factory:

```js
/** @type {import('./src/types.js').PolicyFactory} */
export default function createPolicy({ random, seed, config }) {
  return {
    name: 'my-ai',
    reset({ episode }) {
      // Reset per-round memory here. Called before the first decision each round.
    },
    async decide(state, { episode, step, dtMs }) {
      // Inspect state.self, state.snakes, state.food, state.prey, etc.
      return { heading: random() * 2 * Math.PI, boost: false };
    },
  };
}
```

```sh
npm start -- --ai ./my-ai.js --seed 42
npm start -- --ai ./my-ai.js --ai-config ./config.json --ai-timeout-ms 2000
```

`decide` is called only while playing with a valid `self`. It may be synchronous or asynchronous. Actions contain a finite heading and optional boolean boost; headings are normalized to `[0, 2π)`. Boost holds the mouse button and consumes length in the game. `dtMs` measures elapsed time between decisions. `step` counts decisions across the whole run; `episode` starts at 1.

Policies live in a worker thread so a stuck synchronous policy cannot hang the browser controller. Calls have a 1-second timeout by default; invalid actions, thrown errors, or timeouts stop the run and close the browser. Initialization has a 10-second limit. The worker is a responsiveness boundary, **not a security sandbox**: local policy modules are trusted code. Browser objects are kept in the controller, not passed to policies.

The adapter depends on the game's public JavaScript internals, currently `game1107249518.js`, live-checked with protocol 19. Changes to those internals may require updating `src/state.js`; an incompatible client produces an error instead of a fabricated empty observation. The official HTTPS URL currently redirects to the game's HTTP page, which uses WebSockets. The bot follows that normal redirect without disabling browser security settings.

## Outputs and verification

By default outputs go to `artifacts/` (git-ignored):

- `latest-state.json`: a full observation, atomically replaced about once per second and at shutdown.
- `last-run.json`: decisions, rounds, deaths, observed entity maxima, timing, and any error.
- `<timestamp>-events.jsonl`: round and connection events.
- `<timestamp>-decisions.jsonl`: Jev choices/usage/latency or MCTS search statistics, plus any fallback/discard reason. Saved even without `--record`.
- `<timestamp>-steps.jsonl`: full observations, actions, and timing when `--record` is enabled. This can grow quickly because no entities or minimap cells are omitted.
- `last-screen.png`: screenshot at shutdown when `--screenshot` is enabled.

Use different `--output` directories for concurrent runs. Snapshots describe their `capturedAt` time, not current state after the process exits.

```sh
npm test             # Offline contract, worker-timeout, action, and lifecycle tests
npm run test:live    # 90-second opt-in real-game check; joins as one player
```

The live check verifies movement, mouse heading, boost press/release, other snake geometry, food, minimap data, and recovery after closing its own game socket. It also compares exported entity positions, body points, and minimap cells with raw client objects in the same browser frame. Actual deaths/respawns are additionally exercised in ordinary live runs. Evidence from this setup is under `artifacts/random-smoke/` and `artifacts/live-check/`; these generated files are local, not required to run the bot.

If launch fails, run `npm run setup` or select `--channel chrome`. Connection failures are retried with a fresh page up to three times, then reported. IPv6 probe errors alone are not fatal if the game selects a working IPv4 server. Closing the browser manually ends the run with a clear Playwright error. Nothing is installed as a background service and no bots remain running after a completed command.
