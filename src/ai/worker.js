import { parentPort, workerData } from 'node:worker_threads';

// Mulberry32: reproducible policy decisions, not reproducible multiplayer rounds.
let seed = workerData.seed >>> 0;
const random = () => {
  let value = seed += 0x6D2B79F5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

let policy;
try {
  const module = await import(workerData.moduleUrl);
  if (typeof module.default !== 'function') throw new Error('AI module must default-export createPolicy(context).');
  policy = await module.default({ random, seed: workerData.seed, config: workerData.config, tickMs: workerData.tickMs, decisionTimeoutMs: workerData.decisionTimeoutMs });
  if (typeof policy?.decide !== 'function') throw new Error('Policy must implement decide(state, context).');
  parentPort.postMessage({ ready: true, name: policy.name ?? 'custom' });
} catch (error) { parentPort.postMessage({ error: error.message }); }

parentPort.on('message', async ({ id, method, args }) => {
  try {
    const result = await policy[method]?.(...args);
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
