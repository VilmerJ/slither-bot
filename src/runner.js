import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { SlitherBrowser } from './browser.js';
import { PolicyHost } from './ai/host.js';
import { Recorder } from './recorder.js';

export async function runBot(options = {}, dependencies = {}) {
  const { tickMs = 200, duration = 0, nickname = 'Random bot', respawn = true,
    connectTimeoutMs = 30000, maxReconnects = 3, signal, log = console.log } = options;
  const game = dependencies.game ?? new SlitherBrowser(options);
  const policy = dependencies.policy ?? new PolicyHost(options);
  const recorder = dependencies.recorder ?? new Recorder(options.output, options.record);
  const startedAt = Date.now();
  const summary = { startedAt, endedAt: null, policy: null, episodes: 0, deaths: 0, reconnects: 0, steps: 0,
    maxOtherSnakes: 0, maxFood: 0, maxPrey: 0, minimapObserved: false, error: null,
    ai: { requests: 0, jevDecisions: 0, fallbackDecisions: 0, discardedDecisions: 0, timeouts: 0,
      totalRequestMs: 0, meanRequestMs: 0, maxRequestMs: 0, inputTokensReported: 0, outputTokensReported: 0, requestsWithoutUsage: 0 } };
  let activeEpisode = false, waitingSince = Date.now(), lastState, lastLogAt = 0, previousStepAt;
  const emit = async event => { log(JSON.stringify(event)); await recorder.event(event); };
  const recordDecision = async (action, context, discarded = null) => {
    const detail = action.decision;
    if (!detail) return;
    if (detail.provider === 'mcts') {
      const search = summary.search;
      search.searches++;
      search.totalMs += detail.searchMs;
      search.meanMs = Math.round(search.totalMs / search.searches * 10) / 10;
      search.maxMs = Math.max(search.maxMs, detail.searchMs);
      search.totalIterations += detail.iterations;
      search.maxDepth = Math.max(search.maxDepth, detail.maxDepth);
      if (discarded) search.discarded++;
      else if (detail.source === 'fallback') search.fallbacks++;
      else search.decisions++;
    } else {
      if (detail.requested) {
        summary.ai.requests++;
        summary.ai.totalRequestMs += detail.requestMs ?? 0;
        summary.ai.maxRequestMs = Math.max(summary.ai.maxRequestMs, detail.requestMs ?? 0);
        summary.ai.meanRequestMs = Math.round(summary.ai.totalRequestMs / summary.ai.requests);
        summary.ai.inputTokensReported += detail.inputTokens ?? 0;
        summary.ai.outputTokensReported += detail.outputTokens ?? 0;
        if (detail.inputTokens === undefined) summary.ai.requestsWithoutUsage++;
      }
      if (discarded) summary.ai.discardedDecisions++;
      else if (detail.source === 'jev') summary.ai.jevDecisions++;
      else summary.ai.fallbackDecisions++;
      if (detail.reason === 'timeout') summary.ai.timeouts++;
    }
    await recorder.decision?.({ ...context, ...detail, discarded, heading: action.heading, boost: action.boost });
  };
  const recover = async reason => {
    if (summary.reconnects >= maxReconnects) throw new Error(`Connection recovery exhausted: ${reason}`);
    summary.reconnects++;
    activeEpisode = false;
    await emit({ type: 'reconnect', attempt: summary.reconnects, reason });
    await game.release();
    await game.load();
    waitingSince = Date.now();
  };
  try {
    await recorder.open();
    summary.policy = await policy.ready;
    if (summary.policy === 'mcts') summary.search = { searches: 0, decisions: 0, fallbacks: 0, discarded: 0,
      totalMs: 0, meanMs: 0, maxMs: 0, totalIterations: 0, maxDepth: 0 };
    await emit({ type: 'start', policy: summary.policy, tickMs, seed: options.seed ?? 1,
      coverage: 'All client-loaded entities; distant entities are unavailable. Minimap is anonymous occupancy.' });
    await game.open();
    waitingSince = Date.now();
    while (!signal?.aborted && (!duration || Date.now() - startedAt < duration * 1000)) {
      const stepStarted = performance.now();
      const state = await game.observe();
      lastState = state;
      if (signal?.aborted || (duration && Date.now() - startedAt >= duration * 1000)) break;
      if (state.status === 'playing') {
        if (state.client.lastMessageAt && Date.now() - state.client.lastMessageAt > 15000) {
          await recover('No game-server messages for 15 seconds.');
          continue;
        }
        waitingSince = Date.now();
        if (!activeEpisode) {
          summary.episodes++;
          activeEpisode = true;
          previousStepAt = undefined;
          await policy.reset({ episode: summary.episodes });
          await emit({ type: 'episode-start', episode: summary.episodes, selfId: state.self.id });
        }
        const context = { episode: summary.episodes, step: summary.steps, dtMs: previousStepAt === undefined ? tickMs : stepStarted - previousStepAt };
        previousStepAt = stepStarted;
        // Do not hold a previous boost while waiting on a network inference.
        if (summary.policy === 'jev') await game.release();
        const action = await policy.decide(state, context);
        if (signal?.aborted || (duration && Date.now() - startedAt >= duration * 1000)) {
          await recordDecision(action, context, 'stopped');
          break;
        }
        if (action.expiresAt !== undefined) {
          const current = await game.observe();
          lastState = current;
          if (signal?.aborted || (duration && Date.now() - startedAt >= duration * 1000)) {
            await recordDecision(action, context, 'stopped');
            break;
          }
          if (current.status !== 'playing' || current.self.id !== state.self.id) {
            await game.release();
            await recordDecision(action, context, 'round-ended');
            continue;
          }
          if (Date.now() > action.expiresAt) {
            action.heading = current.self.heading;
            action.boost = false;
            if (action.decision) action.decision = { ...action.decision, source: 'fallback', reason: 'stale-response' };
          } else if (action.decision?.source === 'fallback') action.heading = current.self.heading;
        }
        await game.act(action);
        await recordDecision(action, context);
        summary.steps++;
        summary.maxOtherSnakes = Math.max(summary.maxOtherSnakes, state.snakes.filter(s => !s.isSelf).length);
        summary.maxFood = Math.max(summary.maxFood, state.food.length);
        summary.maxPrey = Math.max(summary.maxPrey, state.prey.length);
        summary.minimapObserved ||= Boolean(state.minimap);
        await recorder.step(state, action, context);
        if (Date.now() - lastLogAt > 5000) {
          await emit({ type: 'tick', episode: summary.episodes, steps: summary.steps, score: state.self.score,
            snakes: state.snakes.length, food: state.food.length, prey: state.prey.length,
            ...(action.decision?.provider === 'jev' ? { ai: action.decision.source, requestMs: action.decision.requestMs ?? null,
              jevDecisions: summary.ai.jevDecisions, fallbacks: summary.ai.fallbackDecisions } : {}),
            ...(action.decision?.provider === 'mcts' ? { ai: action.decision.source, searchMs: action.decision.searchMs,
              iterations: action.decision.iterations, depth: action.decision.maxDepth } : {}) });
          lastLogAt = Date.now();
        }
      } else {
        if (activeEpisode) {
          activeEpisode = false;
          await game.release();
          if (state.status === 'dead') summary.deaths++;
          await emit({ type: 'episode-end', episode: summary.episodes, reason: state.status, score: state.self?.score ?? null });
          if (!respawn) break;
          waitingSince = Date.now();
        }
        if (Date.now() - waitingSince > connectTimeoutMs) {
          await recover(`Game remained ${state.status} for ${connectTimeoutMs}ms.`);
          continue;
        }
        if (state.status === 'menu') {
          try { await game.start(nickname); }
          catch (error) { await recover(`Could not start round: ${error.message}`); }
        }
      }
      const remaining = tickMs - (performance.now() - stepStarted);
      if (remaining > 0) await sleep(remaining, undefined, { signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
    }
  } catch (error) {
    summary.error = error.message;
    throw error;
  } finally {
    summary.endedAt = Date.now();
    try {
      if (lastState) await recorder.snapshot(lastState);
      if (options.screenshot && game.page && !game.page.isClosed()) {
        await game.page.screenshot({ path: `${recorder.output}/last-screen.png` }).catch(() => {});
      }
      await recorder.summary(summary);
    } finally {
      await Promise.allSettled([game.close(), policy.close()]);
    }
  }
  return summary;
}
