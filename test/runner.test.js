import test from 'node:test';
import assert from 'node:assert/strict';
import { runBot } from '../src/runner.js';

function harness(statuses) {
  const controller = new AbortController();
  const events = [], actions = [], resets = [], snapshots = [];
  let starts = 0, released = 0, closed = 0, reads = 0;
  const game = {
    async open() {}, async load() {},
    async observe() {
      const status = statuses[reads++];
      if (reads === statuses.length) controller.abort();
      return { schemaVersion: 1, status, client: {}, self: { id: 7, score: 12 },
        snakes: [{ id: 7, isSelf: true }, { id: 8, isSelf: false }], food: [{ id: 1 }], prey: [], minimap: { cells: [1] } };
    },
    async start() { starts++; }, async act(a) { actions.push(a); },
    async release() { released++; }, async close() { closed++; },
  };
  const policy = { ready: Promise.resolve('fake'), async reset(c) { resets.push(c); },
    async decide() { return { heading: 0, boost: false }; }, async close() { closed++; } };
  const recorder = { async open() {}, async event(e) { events.push(e); }, async step() {},
    async snapshot(s) { snapshots.push(s); }, async summary() {} };
  return { controller, events, actions, resets, snapshots, game, policy, recorder,
    counts: () => ({ starts, released, closed }) };
}

test('runner starts, steers, releases on death, resets policy, and respawns', async () => {
  const h = harness(['menu', 'connecting', 'playing', 'dead', 'dead', 'menu', 'playing', 'menu']);
  const result = await runBot({ tickMs: 1, signal: h.controller.signal, log() {} }, h);
  assert.equal(result.episodes, 2);
  assert.equal(result.deaths, 1);
  assert.equal(result.steps, 2);
  assert.equal(h.counts().starts, 2);
  assert.equal(h.counts().closed, 2);
  assert.deepEqual(h.resets, [{ episode: 1 }, { episode: 2 }]);
  assert.equal(h.actions.length, 2);
  assert.equal(result.maxOtherSnakes, 1);
  assert.equal(h.counts().released, 1); // Death releases input; close handles final cleanup.
});

test('no-respawn ends after one death and still saves the final snapshot', async () => {
  const h = harness(['playing', 'dead', 'menu']);
  const result = await runBot({ tickMs: 1, respawn: false, log() {} }, h);
  assert.equal(result.episodes, 1);
  assert.equal(result.deaths, 1);
  assert.equal(h.snapshots.at(-1).status, 'dead');
  assert.equal(h.counts().closed, 2);
});

test('AI error closes browser and worker without applying an action', async () => {
  const h = harness(['playing', 'menu']);
  h.policy.decide = async () => { throw new Error('bad policy'); };
  await assert.rejects(runBot({ tickMs: 1, log() {} }, h), /bad policy/);
  assert.equal(h.actions.length, 0);
  assert.equal(h.counts().closed, 2);
});

test('stalled network triggers bounded reloads and reports exhaustion', async () => {
  const h = harness([]);
  let loads = 0;
  h.game.load = async () => { loads++; };
  h.game.observe = async () => ({ status: 'playing', client: { lastMessageAt: Date.now() - 20000 } });
  await assert.rejects(runBot({ tickMs: 1, maxReconnects: 2, log() {} }, h), /Connection recovery exhausted/);
  assert.equal(loads, 2);
  assert.equal(h.actions.length, 0);
  assert.equal(h.counts().closed, 2);
});

function inferenceHarness() {
  const h = harness([]);
  const decisions = [];
  h.game.observe = async () => ({ status: 'playing', capturedAt: Date.now(), client: {},
    self: { id: 7, heading: 1.5, score: 12 }, snakes: [], food: [], prey: [] });
  h.policy.ready = Promise.resolve('jev');
  h.policy.decide = async () => {
    assert.ok(h.counts().released > 0, 'release boost before waiting for inference');
    return { heading: 0.5, boost: true, expiresAt: Date.now() + 800,
      decision: { provider: 'jev', source: 'jev', requested: true, requestMs: 120, inputTokens: 2000, outputTokens: 100 } };
  };
  h.game.act = async action => { h.actions.push(action); h.controller.abort(); };
  h.recorder.decision = async decision => { decisions.push(decision); };
  return { ...h, decisions };
}

test('Jev answers are applied after freshness check and recorded with request metrics', async () => {
  const h = inferenceHarness();
  const result = await runBot({ tickMs: 1, signal: h.controller.signal, log() {} }, h);
  assert.equal(h.actions[0].heading, 0.5);
  assert.equal(h.actions[0].boost, true);
  assert.equal(result.ai.jevDecisions, 1);
  assert.equal(result.ai.requests, 1);
  assert.equal(result.ai.meanRequestMs, 120);
  assert.equal(result.ai.inputTokensReported, 2000);
  assert.equal(h.decisions[0].source, 'jev');
});

test('expired inference uses the current heading without boost', async () => {
  const h = inferenceHarness();
  const decide = h.policy.decide;
  h.policy.decide = async () => ({ ...await decide(), expiresAt: Date.now() - 1 });
  const result = await runBot({ tickMs: 1, signal: h.controller.signal, log() {} }, h);
  assert.equal(h.actions[0].heading, 1.5);
  assert.equal(h.actions[0].boost, false);
  assert.equal(h.decisions[0].reason, 'stale-response');
  assert.equal(result.ai.jevDecisions, 0);
  assert.equal(result.ai.fallbackDecisions, 1);
});

test('inference is discarded if the round ends while the request is in flight', async () => {
  const h = inferenceHarness();
  const observe = h.game.observe;
  let reads = 0;
  h.game.observe = async () => {
    const state = await observe();
    if (++reads > 1) state.status = 'dead';
    return state;
  };
  const result = await runBot({ tickMs: 1, respawn: false, signal: h.controller.signal, log() {} }, h);
  assert.equal(h.actions.length, 0);
  assert.equal(result.ai.discardedDecisions, 1);
  assert.equal(h.decisions[0].discarded, 'round-ended');
  assert.equal(result.deaths, 1);
});

test('stopping during the post-inference observation never applies an action', async () => {
  const h = inferenceHarness();
  const observe = h.game.observe;
  let reads = 0;
  h.game.observe = async () => {
    if (++reads === 2) h.controller.abort();
    return observe();
  };
  const result = await runBot({ tickMs: 1, signal: h.controller.signal, log() {} }, h);
  assert.equal(h.actions.length, 0);
  assert.equal(h.decisions[0].discarded, 'stopped');
  assert.equal(result.ai.discardedDecisions, 1);
  assert.equal(h.counts().closed, 2);
});

test('MCTS telemetry and expired actions are counted separately from Jev API calls', async () => {
  const h = inferenceHarness();
  h.policy.ready = Promise.resolve('mcts');
  h.policy.decide = async () => ({ heading: 0.5, boost: false, expiresAt: Date.now() - 1,
    decision: { provider: 'mcts', source: 'mcts', searchMs: 35, iterations: 800, maxDepth: 5 } });
  const result = await runBot({ tickMs: 1, signal: h.controller.signal, log() {} }, h);
  assert.equal(h.actions[0].heading, 1.5);
  assert.equal(h.decisions[0].provider, 'mcts');
  assert.equal(h.decisions[0].source, 'fallback');
  assert.equal(result.search.fallbacks, 1);
  assert.equal(result.search.decisions, 0);
  assert.equal(result.search.meanMs, 35);
  assert.equal(result.search.totalIterations, 800);
  assert.equal(result.ai.requests, 0);
  assert.equal(result.ai.fallbackDecisions, 0);
});
