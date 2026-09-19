import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, moves } from '../src/ai/mcts-model.js';
import createPolicy from '../src/ai/mcts.js';
import { PolicyHost } from '../src/ai/host.js';

function scene() {
  const self = { id: 1, head: { x: 0, y: 0 }, heading: 0, visualRadius: 5, scale: 1,
    normalSpeed: 6.4, speed: 6.4, turnRate: 4, alive: true, isSelf: true, body: [] };
  return { capturedAt: Date.now(), status: 'playing', self, snakes: [self], food: [], prey: [],
    arena: { bounded: true, center: { x: 0, y: 0 }, radius: 5000 } };
}
function random(seed = 42) {
  return () => { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296; };
}
function opponent(head, body = [], speed = 0, heading = 0) {
  return { id: 2, alive: true, isSelf: false, visualRadius: 5, head, body, speed, heading };
}
const search = (state, config = {}) => createPolicy({ random: random(), config: { maxIterations: 1200, ...config } }, { now: () => 0 }).decide(state);

test('simulator follows calibrated speed and bounded turning instead of teleporting headings', () => {
  const model = createModel(scene(), { stepMs: 200 });
  const straight = model.step(model.initial, moves[0]);
  assert.ok(Math.abs(straight.x - 40) < 1e-8);
  assert.equal(straight.y, 0);
  const left = model.step(model.initial, moves[3]);
  assert.ok(Math.abs(left.heading + 0.8) < 1e-8);
  assert.ok(left.y < 0 && left.x > 0);
  assert.equal(model.initial.heading, 0);
});

test('swept collision catches a crossing body with distant endpoints; dead snakes are excluded', () => {
  const state = scene();
  state.snakes.push(opponent({ x: 20, y: -10000 }, [{ x: 20, y: 10000, dying: false }]));
  const model = createModel(state, { safetyMargin: 0 });
  assert.equal(model.step(model.initial, moves[0]).alive, false);
  state.snakes[1].alive = false;
  const cleared = createModel(state);
  assert.equal(cleared.step(cleared.initial, moves[0]).alive, true);
});

test('opponent head motion creates future collision risk beyond the current body', () => {
  const state = scene();
  state.snakes.push(opponent({ x: 40, y: -40 }, [], 6.4, Math.PI / 2));
  const model = createModel(state, { safetyMargin: 0 });
  assert.equal(model.step(model.initial, moves[0]).alive, false);
  state.snakes[1].speed = 0;
  const stationary = createModel(state, { safetyMargin: 0 });
  assert.equal(stationary.step(stationary.initial, moves[0]).alive, true);
});

test('food is collected once per trajectory and simulation branches stay independent', () => {
  const state = scene();
  state.food.push({ position: { x: 30, y: 0 }, size: 5, eaten: false },
    { position: { x: 30, y: 0 }, size: 50, eaten: true });
  const model = createModel(state);
  const first = model.step(model.initial, moves[0]);
  assert.equal(first.food, 5);
  const revisited = model.step({ ...first, x: 0, y: 0 }, moves[0]);
  assert.equal(revisited.food, 5);
  assert.equal(model.initial.eaten.size, 0);
  assert.equal(model.step(model.initial, moves[0]).food, 5);
  assert.ok(model.reward({ ...first, alive: false, food: 100000 }) < model.reward(model.initial));
});

test('MCTS expands multiple levels, backs up visits, and is repeatable with a fixed iteration budget', () => {
  const state = scene();
  state.food.push({ position: { x: 100, y: 0 }, size: 8, eaten: false });
  const a = search(state), b = search(state);
  assert.deepEqual(a, b);
  assert.equal(a.decision.iterations, 1200);
  assert.equal(a.decision.root.reduce((total, child) => total + child.visits, 0), 1200);
  assert.ok(a.decision.maxDepth >= 3);
  assert.ok(a.decision.nodes > 20);
  assert.equal(a.decision.choice, 'forward');
  assert.equal(a.boost, false);
});

test('MCTS steers away from an arena edge instead of pursuing food through it', () => {
  const state = scene();
  state.self.head.x = 480;
  state.arena.radius = 530;
  state.food.push({ position: { x: 540, y: 0 }, size: 50, eaten: false });
  const action = search(state, { safetyMargin: 0 });
  assert.ok(['hard_left', 'hard_right'].includes(action.decision.choice));
  const model = createModel(state, { safetyMargin: 0 });
  const move = moves.find(m => m.name === action.decision.choice);
  assert.equal(model.step(model.initial, move).alive, true);
});

test('MCTS avoids food behind an enemy body and handles unavoidable collisions', () => {
  const state = scene();
  state.snakes.push(opponent({ x: 70, y: -120 }, [{ x: 70, y: 120, dying: false }]));
  state.food.push({ position: { x: 100, y: 0 }, size: 50, eaten: false });
  const action = search(state);
  assert.ok(['hard_left', 'hard_right'].includes(action.decision.choice));
  state.snakes[1].head = { x: 0, y: 0 };
  state.snakes[1].body = [];
  const trapped = search(state);
  assert.ok(Number.isFinite(trapped.heading));
  assert.ok(trapped.decision.root.every(child => !child.survivesFirstMove));
});

test('elapsed budget stops expansion after checking all first moves; bad config is rejected', () => {
  let elapsed = 0;
  const policy = createPolicy({ random: random(), config: { budgetMs: 5 } }, { now: () => elapsed += 10 });
  const action = policy.decide(scene());
  assert.equal(action.decision.iterations, 5);
  assert.equal(action.decision.root.length, 5);
  for (const config of [{ depth: 0 }, { maxIterations: 2.5 }, { budgetMs: 1000 }, { safetyMargin: -1 }]) {
    assert.throws(() => createPolicy({ config }), /MCTS/);
  }
});

test('worker loads MCTS without an API key and preserves search telemetry and freshness deadline', async () => {
  const policy = new PolicyHost({ ai: 'mcts', tickMs: 100, config: { maxIterations: 10 } });
  try {
    assert.equal(await policy.ready, 'mcts');
    const state = scene();
    const action = await policy.decide(state, {});
    assert.equal(action.decision.provider, 'mcts');
    assert.equal(action.decision.horizonMs, 1000);
    assert.equal(action.expiresAt, state.capturedAt + 400);
    assert.ok(action.heading >= 0 && action.heading < Math.PI * 2);
  } finally { await policy.close(); }
});
