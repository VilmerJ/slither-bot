# Whole-arena state investigation

The bot provides all detailed entities the public client currently holds. The requested exact whole-arena entity list remains unavailable. This is a data-source limit, not a completed whole-world implementation.

## Evidence inspected on 2026-09-18

- Public client: [game1107249518.js](https://slither.io/s/game1107249518.js), SHA-256 `5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095`; live protocol 19.
- The `s` packet handler creates detailed snake objects and also removes snakes without marking them killed. There is no retained exact state for those removed objects.
- The `M` and `V` minimap handlers decode and update occupancy cells. Those cells contain neither snake identities nor exact body coordinates. The adapter's exported cells were checked against the client's `mmdata` in the same browser frame.
- Inspection of the client's WebSocket sends found game login, input, ping, and related controls, but no request to enumerate every entity in the arena. This does not establish what undocumented capabilities the private server may have.
- In a live snapshot, the client held 5 detailed snakes while the server-reported player count was 285. The exported snake positions and every body point matched the raw client objects; food and prey lists were also compared. See local `artifacts/live-check/state-audit.json`.
- A separate temporary session reduced the camera scale from approximately 1.157 to 0.087. After six seconds the client still held only 7 detailed snakes out of 287 players. The minimap remained a 136 × 136 occupancy grid. This demonstrates that zooming out did not provide the requested whole-arena entity state in that session. Changes in the nearby entity counts during movement are not treated as a controlled causal effect of zoom. See local `artifacts/coverage-audit/report.json` and `zoomed.png`.

The zoom audit's initial raw player count was zero because the first leaderboard update had not arrived. The adapter now normalizes that sentinel to `null`, along with unknown rank and best-rank values.

## What would unblock the remaining requirement

Exact, current identities and geometry for every snake and food item would need a data source that actually supplies them: server-side access or an explicit full-world state API. Neither is available in this workspace or exposed by the inspected public client.

Recording old positions, inferring snakes from minimap pixels, or moving through the arena cannot provide a simultaneous exact world state. The bot therefore exposes `coverage.fullWorld: false`, current loaded entities, and anonymous minimap cells. A future full-world provider can extend the observation contract when such a source is available; this implementation does not label estimates or stale data as exact state.
