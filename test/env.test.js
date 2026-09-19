import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadEnv } from '../src/env.js';

test('local env file is optional and never overrides exported settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slither-env-'));
  try {
    const target = { TYPESAFE_API_KEY: 'exported-test-key' };
    loadEnv(join(directory, 'absent'), target);
    await writeFile(join(directory, '.env'), 'TYPESAFE_API_KEY="file-test-key"\nTYPESAFE_MODEL=jev-latest\n');
    loadEnv(join(directory, '.env'), target);
    assert.deepEqual(target, { TYPESAFE_API_KEY: 'exported-test-key', TYPESAFE_MODEL: 'jev-latest' });
  } finally { await rm(directory, { recursive: true }); }
});
