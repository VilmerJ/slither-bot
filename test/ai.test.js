import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyHost } from '../src/ai/host.js';

test('seeded random AI yields reproducible, changing headings', async () => {
  const a = new PolicyHost({ seed: 42 }), b = new PolicyHost({ seed: 42 });
  try {
    assert.equal(await a.ready, 'random');
    const headings = [];
    for (let i = 0; i < 8; i++) {
      const first = await a.decide({}, {}), second = await b.decide({}, {});
      assert.deepEqual(first, second);
      assert.equal(first.boost, false);
      headings.push(first.heading);
    }
    assert.equal(new Set(headings).size, 8);
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('custom async policy receives state/config and resets each episode', async () => {
  const ai = new PolicyHost({ ai: './test/fixtures/custom-ai.js', config: { offset: 0.5 } });
  try {
    assert.equal(await ai.ready, 'test-custom');
    const state = { self: { heading: 0.5 } };
    assert.equal((await ai.decide(state, {})).heading, 1);
    assert.equal((await ai.decide(state, {})).heading, 2);
    await ai.reset({ episode: 2 });
    assert.equal((await ai.decide(state, {})).heading, 1);
  } finally { await ai.close(); }
});

test('hung synchronous AI is terminated without hanging the controller', async () => {
  const ai = new PolicyHost({ ai: './test/fixtures/stuck-ai.js', timeoutMs: 50 });
  try { await ai.ready; await assert.rejects(ai.decide({}, {}), /exceeded 50ms/); }
  finally { await ai.close(); }
});

test('missing policy module produces an actionable error', async () => {
  const ai = new PolicyHost({ ai: './does-not-exist.js' });
  try { await assert.rejects(ai.ready, /Cannot find module/); }
  finally { await ai.close(); }
});
