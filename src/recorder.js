import { mkdir, writeFile, rename, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class Recorder {
  constructor(output = 'artifacts', record = false) {
    this.output = resolve(output);
    this.record = record;
    this.lastSnapshotAt = 0;
    this.runId = new Date().toISOString().replace(/[:.]/g, '-');
  }
  async open() { await mkdir(this.output, { recursive: true }); }
  async event(event) {
    await appendFile(`${this.output}/${this.runId}-events.jsonl`, JSON.stringify({ time: Date.now(), ...event }) + '\n');
  }
  async decision(decision) {
    await appendFile(`${this.output}/${this.runId}-decisions.jsonl`, JSON.stringify({ time: Date.now(), ...decision }) + '\n');
  }
  async step(state, action, context) {
    if (this.record) await appendFile(`${this.output}/${this.runId}-steps.jsonl`, JSON.stringify({ state, action, context }) + '\n');
    if (Date.now() - this.lastSnapshotAt >= 1000) {
      await this.snapshot(state);
      this.lastSnapshotAt = Date.now();
    }
  }
  async snapshot(state) {
    await writeFile(`${this.output}/latest-state.json.tmp`, JSON.stringify(state));
    await rename(`${this.output}/latest-state.json.tmp`, `${this.output}/latest-state.json`);
  }
  async summary(summary) {
    await writeFile(`${this.output}/last-run.json`, JSON.stringify(summary, null, 2) + '\n');
  }
}
