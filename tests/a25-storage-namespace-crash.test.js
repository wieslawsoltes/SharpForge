import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeFileStore, initNodeRepository } from '../packages/git/src/fs/node.js';

const identity = { name: 'Crash Fixture', email: 'crash@example.test', timestamp: 1700000000, timezone: '+0000' };
const oid = '1'.repeat(40);

async function snapshot(store) {
  const entries = [];
  for (const key of await store.list()) entries.push([key, await store.get(key)]);
  return entries;
}

async function interruptNamespace(t, checkpoint, { source = 'feature', target = 'feature/sub' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-namespace-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const descriptor = await initNodeRepository({ directory, defaultBranch: source });
  await descriptor.refs.update('HEAD', oid, { expected: null, identity });
  const before = await snapshot(descriptor.store);
  await descriptor.odb.close();
  const worker = new Worker(new URL('./git-conformance/namespace-crash-worker.js', import.meta.url), {
    workerData: { directory: descriptor.gitDirectory, checkpoint, source, target, oid, identity },
    resourceLimits: { maxOldGenerationSizeMb: 128 }
  });
  t.after(() => worker.terminate());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Namespace crash checkpoint timed out')), 30_000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker exited ${code} before checkpoint`)); });
    worker.once('message', message => {
      clearTimeout(timer);
      if (message.type === 'checkpoint') resolve(message);
      else reject(new Error(JSON.stringify(message)));
    });
  });
  assert.equal(await worker.terminate(), 1, 'worker must terminate while native publication is suspended');
  const metadata = descriptor.gitDirectory;
  assert.equal(JSON.parse(await readFile(join(metadata, '.sharpforge-node-transaction/manifest'), 'utf8')).state,
    checkpoint.startsWith('prepare:') ? 'prepare' : 'revert');
  const recovered = new NodeFileStore({ directory: metadata });
  t.after(() => recovered.close());
  await assert.rejects(recovered.get('HEAD'), { code: 'Conflict' });
  // The fixture has positively terminated the sole owner. Production code never
  // removes this process lock automatically or guesses whether another writer died.
  await rm(join(metadata, '.sharpforge-transaction.lock'));
  return { recovered, metadata, before };
}

for (const [source, target] of [['feature', 'feature/sub'], ['feature/sub', 'feature']]) {
  for (const checkpoint of ['prepare:HEAD', `delete:refs/heads/${source}`, 'publish:HEAD', `publish:logs/refs/heads/${target}`]) {
    test(`Node namespace recovery restores exact pre-rename bytes after actual worker termination at ${checkpoint}`, async t => {
      const { recovered, before } = await interruptNamespace(t, checkpoint, { source, target });
      assert.deepEqual(await snapshot(recovered), before);
      assert.equal((await recovered.io.list()).some(key => key.includes('sharpforge-node-transaction') || key.endsWith('.lock')), false);
    });
  }
}

test('namespace recovery preserves a replacement lock owned by another writer and retains its rollback journal', async t => {
  const { recovered, metadata } = await interruptNamespace(t, 'publish:HEAD');
  const lock = join(metadata, 'refs/heads/feature.lock');
  await rm(lock);
  await writeFile(lock, 'foreign lock after the interrupted transaction');
  await assert.rejects(recovered.get('HEAD'), { code: 'Conflict' });
  assert.equal(await readFile(lock, 'utf8'), 'foreign lock after the interrupted transaction');
  assert.equal(JSON.parse(await readFile(join(metadata, '.sharpforge-node-transaction/manifest'), 'utf8')).state, 'revert');
});
