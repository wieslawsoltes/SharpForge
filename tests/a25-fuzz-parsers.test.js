import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { MutationRandom, mutateBytes } from '../packages/git/fuzz/mutate.js';

function isolatedFuzz() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../packages/git/fuzz/worker.js', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }
    });
    let received = false;
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Git parser fuzz exceeded the fixed 300 second deadline')); }, 300_000);
    worker.once('message', message => {
      received = true;
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (!received) reject(new Error(`Fuzz worker exited without a report: ${code}`));
    });
  });
}

test('A25 one million deterministic parser mutations have bounded memory, time and typed failures', { timeout: 330_000 }, async context => {
  const result = await isolatedFuzz();
  assert.equal(result.inputs, 1_000_000);
  for (const counts of Object.values(result.families)) {
    assert.equal(counts.inputs, 200_000);
    assert.equal(counts.accepted + Object.values(counts.errors).reduce((sum, count) => sum + count, 0), counts.inputs);
    assert.ok(counts.maxInputBytes <= 4096);
  }
  context.diagnostic(`SHARPFORGE_GIT_FUZZ ${JSON.stringify(result)}`);
});

test('mutation replay is deterministic and never changes its seed corpus', () => {
  const source = new TextEncoder().encode('fixed corpus');
  const before = source.slice();
  const left = new MutationRandom(42);
  const right = new MutationRandom(42);
  for (let index = 0; index < 100; index++) assert.deepEqual(mutateBytes(source, left), mutateBytes(source, right));
  assert.deepEqual(source, before);
});
