import { performance } from 'node:perf_hooks';
import { buildJevDecision } from './jev-state.js';

const endpoint = 'https://api.typesafe.ai/v1/systemone';
const boundedNumber = (value, fallback, min, max, name) => {
  value ??= fallback;
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Jev ${name} must be between ${min} and ${max}.`);
  return value;
};

export function retryDelay(value, now) {
  if (!value) return 0;
  const delay = Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

export function createJevPolicy({ config = {}, decisionTimeoutMs = 1000 } = {}, dependencies = {}) {
  const apiKey = dependencies.apiKey ?? process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY;
  if (!apiKey?.trim()) throw new Error('Jev requires TYPESAFE_API_KEY in .env or the environment.');
  const model = config.model ?? process.env.TYPESAFE_MODEL ?? 'jev-latest';
  if (typeof model !== 'string' || !/^jev-[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Jev model must be a Jev model ID or alias.');
  const timeoutMs = boundedNumber(config.requestTimeoutMs, Math.min(850, decisionTimeoutMs - 100), 20, decisionTimeoutMs - 50, 'requestTimeoutMs');
  const maxAgeMs = boundedNumber(config.maxDecisionAgeMs, 1000, 50, 10000, 'maxDecisionAgeMs');
  const lookahead = boundedNumber(config.lookahead, 240, 50, 1000, 'lookahead');
  const maxFailures = boundedNumber(config.maxConsecutiveFailures, 8, 1, 100, 'maxConsecutiveFailures');
  if (config.allowBoost !== undefined && typeof config.allowBoost !== 'boolean') throw new Error('Jev allowBoost must be a boolean.');
  const request = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  let failures = 0, retryAt = 0;
  const fallback = (state, reason, metrics = {}) => ({ heading: state.self.heading, boost: false,
    expiresAt: state.capturedAt + maxAgeMs,
    decision: { provider: 'jev', source: 'fallback', reason, requested: false, ...metrics } });
  const failed = (state, reason, metrics, retryAfter = 0) => {
    failures++;
    if (failures >= maxFailures) throw new Error(`Jev failed ${failures} consecutive requests (${reason}); stopping. Check connectivity, service status, and API configuration.`);
    retryAt = now() + Math.max(retryAfter, Math.min(30000, 500 * 2 ** (failures - 1)));
    return fallback(state, reason, metrics);
  };
  return {
    name: 'jev',
    // Backoff is service-wide and intentionally survives deaths/respawns.
    async decide(state) {
      if (now() < retryAt) return fallback(state, 'backoff');
      if (now() - state.capturedAt > maxAgeMs) return fallback(state, 'stale-observation');
      const decision = buildJevDecision(state, { lookahead, allowBoost: config.allowBoost ?? true });
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), timeoutMs);
      const started = performance.now();
      let response, data;
      const metrics = () => ({ requested: true, requestMs: Math.round(performance.now() - started), model });
      try {
        response = await request(endpoint, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, state: decision.state, questions: decision.questions }), signal: controller.signal });
        if (response.ok) data = await response.json();
      } catch {
        return failed(state, controller.signal.aborted ? 'timeout' : response?.ok ? 'invalid-response' : 'network', metrics());
      } finally { clearTimeout(deadline); }
      if (!response.ok) {
        // Never include response bodies or request headers in errors/logs.
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) throw new Error(`Jev authentication failed (HTTP ${response.status}); check TYPESAFE_API_KEY.`);
        if (response.status !== 429 && response.status < 500) throw new Error(`Jev request rejected (HTTP ${response.status}); check model, account, and request configuration.`);
        return failed(state, response.status === 429 ? 'rate-limit' : 'service-error', { ...metrics(), httpStatus: response.status }, retryDelay(response.headers.get('retry-after'), now()));
      }
      const answer = data?.answers?.move;
      if (answer?.type !== 'choice' || !Object.hasOwn(decision.actions, answer.choice) ||
          !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
        return failed(state, 'invalid-response', metrics());
      }
      failures = 0; retryAt = 0;
      const usage = field => Number.isSafeInteger(data.usage?.[field]) && data.usage[field] >= 0 ? data.usage[field] : undefined;
      const detail = { ...metrics(), confidence: answer.confidence, choice: answer.choice,
        model: typeof data.model === 'string' && /^jev-[a-zA-Z0-9._-]+$/.test(data.model) ? data.model : model,
        inputTokens: usage('input_tokens'), outputTokens: usage('output_tokens'),
        probabilities: Object.fromEntries(Object.entries(answer.probabilities ?? {}).filter(([key, value]) =>
          Object.hasOwn(decision.actions, key) && Number.isFinite(value) && value >= 0 && value <= 1)) };
      if (now() - state.capturedAt > maxAgeMs) return fallback(state, 'stale-response', detail);
      return { ...decision.actions[answer.choice], expiresAt: state.capturedAt + maxAgeMs,
        decision: { provider: 'jev', source: 'jev', ...detail } };
    },
  };
}

export default createJevPolicy;
