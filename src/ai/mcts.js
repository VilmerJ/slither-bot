import { performance } from 'node:perf_hooks';
import { createModel, moves } from './mcts-model.js';

const number = (value, fallback, min, max, name, integer = false) => {
  value ??= fallback;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`MCTS ${name} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
  }
  return value;
};

export default function createPolicy({ random = Math.random, config = {}, tickMs = 200, decisionTimeoutMs = 1000 } = {}, { now = performance.now.bind(performance) } = {}) {
  const budgetMs = number(config.budgetMs, Math.min(40, decisionTimeoutMs - 50), 1, decisionTimeoutMs - 50, 'budgetMs');
  const maxIterations = number(config.maxIterations, 1500, 5, 100000, 'maxIterations', true);
  const depth = number(config.depth, 10, 2, 30, 'depth', true);
  const stepMs = number(config.stepMs, tickMs, 50, 1000, 'stepMs');
  const exploration = number(config.exploration, 0.5, 0, 5, 'exploration');
  const safetyMargin = number(config.safetyMargin, 8, 0, 100, 'safetyMargin');
  const maxAgeMs = number(config.maxDecisionAgeMs, Math.max(400, tickMs * 2), 50, 5000, 'maxDecisionAgeMs');
  const makeNode = (state, parent = null, move = null) => ({ state, parent, move,
    depth: parent ? parent.depth + 1 : 0, visits: 0, value: 0, children: [], untried: [...moves] });
  return {
    name: 'mcts',
    decide(observation) {
      const started = now();
      const model = createModel(observation, { stepMs, depth, safetyMargin });
      const root = makeNode(model.initial);
      let iterations = 0, nodes = 1, maxDepth = 0;
      // Expand every first move at least once, even when setup uses the budget.
      while (iterations < maxIterations && (iterations < moves.length || now() - started < budgetMs)) {
        let node = root;
        while (node.state.alive && node.depth < depth && node.untried.length === 0) {
          let best = null, bestValue = -Infinity;
          for (const child of node.children) {
            const uct = child.value / child.visits + exploration * Math.sqrt(Math.log(node.visits) / child.visits);
            if (uct > bestValue) { bestValue = uct; best = child; }
          }
          node = best;
        }
        if (node.state.alive && node.depth < depth) {
          const [move] = node.untried.splice(Math.floor(random() * node.untried.length), 1);
          const child = makeNode(model.step(node.state, move), node, move);
          node.children.push(child);
          node = child;
          nodes++;
          maxDepth = Math.max(maxDepth, node.depth);
        }
        let rollout = node.state;
        for (let d = node.depth; d < depth && rollout.alive; d++) {
          rollout = model.step(rollout, moves[Math.floor(random() * moves.length)]);
        }
        const value = model.reward(rollout);
        for (let path = node; path; path = path.parent) { path.visits++; path.value += value; }
        iterations++;
      }
      // Robust child: most visited, with value breaking ties. Never knowingly
      // choose an immediate collision when a surviving first move was found.
      const viable = root.children.filter(child => child.state.alive);
      const best = (viable.length ? viable : root.children).sort((a, b) => b.visits - a.visits || b.value / b.visits - a.value / a.visits)[0];
      return {
        heading: observation.self.heading + best.move.turn, boost: false,
        expiresAt: observation.capturedAt + maxAgeMs,
        decision: { provider: 'mcts', source: 'mcts', choice: best.move.name,
          searchMs: Math.round((now() - started) * 10) / 10, iterations, nodes, maxDepth,
          horizonMs: stepMs * depth,
          root: root.children.map(child => ({ choice: child.move.name, visits: child.visits,
            value: Math.round(child.value / child.visits * 1000) / 1000, survivesFirstMove: child.state.alive })) },
      };
    },
  };
}
