import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateAction } from '../actions.js';

export class PolicyHost {
  constructor({ ai = 'random', seed = 1, config = {}, timeoutMs = 1000, tickMs = 200 } = {}) {
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    const moduleUrl = ['random', 'forager', 'jev', 'mcts'].includes(ai) ? new URL(`./${ai}.js`, import.meta.url).href : pathToFileURL(resolve(ai)).href;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { moduleUrl, seed, config, tickMs, decisionTimeoutMs: timeoutMs } });
    this.ready = new Promise((resolve, reject) => {
      this.readyTimer = setTimeout(() => { reject(new Error('AI initialization timed out.')); void this.close(); }, 10000);
      this.pending.set(0, { resolve, reject, timer: this.readyTimer });
    });
    // Initialization can fail while the caller is still opening output files.
    // Keep the original rejecting promise available for callers to await.
    this.ready.catch(() => {});
    this.worker.on('message', message => {
      const id = message.id ?? 0;
      const request = this.pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(id);
      if (message.error) request.reject(new Error(`AI: ${message.error}`));
      else request.resolve(message.ready ? message.name : message.result);
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => this.fail(new Error(`AI worker exited (${code}).`)));
  }

  fail(error) {
    this.failure = error;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  async call(method, ...args) {
    await this.ready;
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AI ${method} exceeded ${this.timeoutMs}ms; stopping the bot.`));
        void this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, method, args });
    });
  }

  async decide(state, context) {
    const result = await this.call('decide', state, context);
    const action = validateAction(result);
    if (result.expiresAt !== undefined) {
      if (!Number.isFinite(result.expiresAt)) throw new Error('AI expiresAt must be a finite timestamp.');
      action.expiresAt = result.expiresAt;
    }
    if (['jev', 'mcts'].includes(result.decision?.provider)) action.decision = result.decision;
    return action;
  }
  async reset(context) { await this.call('reset', context); }
  async close() { this.fail(new Error('AI stopped.')); await this.worker.terminate(); }
}
