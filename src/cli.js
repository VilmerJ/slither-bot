#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { runBot } from './runner.js';
import { loadEnv } from './env.js';

const help = `Slither.io browser bot

  npm start -- [options]

  --ai random|forager|jev|mcts|./my-ai.js  Policy module (default: random)
  --headless                    Hide the browser window
  --channel chrome              Use installed Chrome instead of bundled Chromium
  --nickname "Random bot"        Name shown in the game (max 24 characters)
  --tick-ms 200                  Time between decisions; game runs continuously
  --seed 1                       Seed for the policy's random number generator
  --duration 60                  Stop after this many seconds (0 = until Ctrl+C)
  --no-respawn                   Stop after the first round ends
  --ai-timeout-ms 1000           Maximum time for each policy call
  --ai-config ./config.json      JSON configuration passed to createPolicy
  --record                      Save all observations/actions as JSONL
  --output artifacts            Directory for state, events, and summary
  --screenshot                  Save a screenshot when the bot stops
  --help                        Show this help

State includes all client-loaded entities and the global occupancy minimap.
The public server does not send an exact global entity list.
`;

try {
  const { values } = parseArgs({ options: {
    ai: { type: 'string', default: 'random' }, headless: { type: 'boolean', default: false },
    channel: { type: 'string' }, nickname: { type: 'string', default: 'Random bot' },
    'tick-ms': { type: 'string', default: '200' }, seed: { type: 'string', default: '1' },
    duration: { type: 'string', default: '0' }, 'no-respawn': { type: 'boolean', default: false },
    'ai-timeout-ms': { type: 'string', default: '1000' }, 'ai-config': { type: 'string' },
    record: { type: 'boolean', default: false }, output: { type: 'string', default: 'artifacts' },
    screenshot: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); } else {
    loadEnv();
    const number = (key, min, max) => {
      const value = Number(values[key]);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(`--${key} must be an integer between ${min} and ${max}.`);
      return value;
    };
    if (!values.nickname.trim() || values.nickname.length > 24) throw new Error('--nickname must contain 1–24 characters.');
    const options = {
      ai: values.ai, headless: values.headless, channel: values.channel, nickname: values.nickname,
      tickMs: number('tick-ms', 50, 60000), seed: number('seed', 0, 4294967295),
      duration: number('duration', 0, 86400 * 365), timeoutMs: number('ai-timeout-ms', 1, 60000),
      respawn: !values['no-respawn'], record: values.record, output: values.output, screenshot: values.screenshot,
      config: values['ai-config'] ? JSON.parse(await readFile(values['ai-config'], 'utf8')) : {},
    };
    const controller = new AbortController();
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => controller.abort());
    const summary = await runBot({ ...options, signal: controller.signal });
    console.log(`Stopped: ${summary.steps} decisions across ${summary.episodes} round(s). State saved to ${values.output}/latest-state.json.`);
    if (summary.policy === 'jev') {
      console.log(`Jev: ${summary.ai.jevDecisions} moves, ${summary.ai.fallbackDecisions} fallbacks, ${summary.ai.discardedDecisions} discarded; ${summary.ai.requests} requests averaging ${summary.ai.meanRequestMs}ms.`);
    }
    if (summary.policy === 'mcts') {
      console.log(`MCTS: ${summary.search.decisions} moves, ${summary.search.fallbacks} fallbacks; searches averaged ${summary.search.meanMs}ms and ${Math.round(summary.search.totalIterations / (summary.search.searches || 1))} rollouts.`);
    }
  }
} catch (error) {
  console.error(`Bot failed: ${error.message}`);
  process.exitCode = 1;
}
