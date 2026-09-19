// Opt-in network integration check. Runs one real player and closes it afterward.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { SlitherBrowser } from '../src/browser.js';
import { runBot } from '../src/runner.js';
import { readClientState } from '../src/state.js';

const output = 'artifacts/live-check';
await mkdir(output, { recursive: true });
const game = new SlitherBrowser({ headless: !process.argv.includes('--headed') });
const checks = { steering: false, boost: false, released: false, movement: false,
  entities: false, minimap: false, rawStateAgreement: false, socketDrop: false, recovered: false };
let previousPosition, steps = 0, lastState, leftAfterDrop = false;
const observe = game.observe.bind(game);
game.observe = async () => {
  const state = await observe();
  if (checks.socketDrop && state.status !== 'playing') leftAfterDrop = true;
  if (state.status === 'playing') {
    lastState = state;
    if (previousPosition && Math.hypot(state.self.head.x - previousPosition.x, state.self.head.y - previousPosition.y) > 2) checks.movement = true;
    previousPosition = state.self.head;
    checks.entities ||= state.snakes.some(s => !s.isSelf && s.body.length > 0) && state.food.length > 0;
    checks.minimap ||= Boolean(state.minimap?.cells.some(Boolean));
    if (checks.socketDrop && leftAfterDrop) checks.recovered = true;
  }
  return state;
};
const act = game.act.bind(game);
game.act = async action => {
  const result = await act(action);
  const input = await game.page.evaluate(() => ({ heading: Math.atan2(window.ym, window.xm), boost: window.slither?.wmd }));
  assert.ok(Math.abs(Math.atan2(Math.sin(input.heading - action.heading), Math.cos(input.heading - action.heading))) < 0.02, 'Mouse coordinates match requested heading');
  checks.steering = true;
  steps++;
  if (steps === 3) {
    await act({ heading: action.heading, boost: true });
    assert.equal(await game.page.evaluate(() => window.slither.wmd), true);
    checks.boost = true;
    await game.release();
    assert.equal(await game.page.evaluate(() => window.slither.wmd), false);
    checks.released = true;
  }
  if (!checks.socketDrop && steps >= 35 && checks.entities && checks.minimap) {
    // Read the normalized snapshot and original game objects in one JS turn, so
    // entity arrivals/removals cannot race the comparison. Source is local code.
    const audit = await game.page.evaluate(`(() => {
      const state = (${readClientState.toString()})();
      const snakesMatch = state.snakes.length === slithers.length && state.snakes.every((s, i) =>
        s.id === slithers[i].id && s.head.x === slithers[i].xx && s.head.y === slithers[i].yy &&
        s.body.length === slithers[i].pts.length && s.body.every((p, j) =>
          p.x === slithers[i].pts[j].xx && p.y === slithers[i].pts[j].yy));
      const rawFood = foods.slice(0, foods_c).filter(Boolean);
      const foodMatches = state.food.length === rawFood.length && state.food.every((f, i) =>
        f.id === rawFood[i].id && f.position.x === rawFood[i].xx && f.position.y === rawFood[i].yy);
      const preyMatches = state.prey.length === preys.length && state.prey.every((p, i) =>
        p.id === preys[i].id && p.position.x === preys[i].xx && p.position.y === preys[i].yy);
      const minimapMatches = state.minimap.cells.length === mmdata.length && state.minimap.cells.every((c, i) => c === mmdata[i]);
      return { snakesMatch, foodMatches, preyMatches, minimapMatches,
        playerMatches: state.self.id === slither.id,
        loadedSnakes: slithers.length, totalPlayers: slither_count,
        loadedFood: foods_c, loadedPrey: preys.length, minimapSize: mmsz, protocol: protocol_version };
    })()`);
    await writeFile(`${output}/state-audit.json`, JSON.stringify(audit, null, 2));
    for (const key of ['snakesMatch', 'foodMatches', 'preyMatches', 'minimapMatches', 'playerMatches']) assert.equal(audit[key], true, key);
    checks.rawStateAgreement = true;
    await writeFile(`${output}/observed-state.json`, JSON.stringify(lastState));
    await game.page.screenshot({ path: `${output}/playing.png` });
    await game.page.evaluate(() => window.ws.close());
    checks.socketDrop = true;
    await sleep(100);
  }
  return result;
};

try {
  const result = await runBot({ duration: 90, headless: true, ai: 'random', output, screenshot: true }, { game });
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, result }, null, 2));
  for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, `Live check failed: ${name}`);
  console.log('All live checks passed:', checks);
} catch (error) {
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, error: error.message }, null, 2));
  throw error;
}
