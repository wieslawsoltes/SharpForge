import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkEditorModel } from '../scripts/editor-benchmarks/model.js';
import { benchmarkEditorMemory, memoryDelta } from '../scripts/editor-benchmarks/memory.js';
import { validateEditorReport } from '../scripts/check-editor-perf.js';
import { createBenchmarkServer } from '../scripts/editor-benchmarks/server.js';
import { rootDirectory } from '../scripts/editor-benchmarks/common.js';

// Small real-model fixture verifies harness correctness without placing performance assertions on shared CI timing.
test('model benchmark measures all five actual operations and preserves source correctness', async () => {
  const result = await benchmarkEditorModel({ sizes: [1024], samples: 3, warmups: 0 });
  assert.equal(result.rows.length, 5);
  assert.deepEqual(result.rows.map(row => row.operation),
    ['model.edit', 'model.paste64KiB', 'model.undo64KiB', 'model.findLiteral', 'model.viewportQuery60Lines']);
  assert(result.rows.every(row => row.backend === 'node-model' && row.rawSamplesMs.length === 3));
  assert.equal(validateEditorReport(result), true);
});

test('model benchmark cancellation is explicit and produces no pretend successful report', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(benchmarkEditorModel({ sizes: [1024], samples: 3, signal: controller.signal }), /cancelled/);
});

test('memory runner refuses unavailable GC and preserves signed deltas', async () => {
  await assert.rejects(benchmarkEditorMemory({ sizes: [1024], gc: null }), /expose-gc/);
  assert.deepEqual(memoryDelta({ heapUsedBytes: 80, arrayBufferBytes: 40 }, { heapUsedBytes: 100, arrayBufferBytes: 0 }),
    { heapUsedBytes: -20, arrayBufferBytes: 40 });
});

test('browser harness serves the real editor entry under a strict CSP and rejects malformed resource URLs', async () => {
  const server = await createBenchmarkServer(`${rootDirectory}/`);
  try {
    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-eval|unsafe-inline/);
    assert.match(await page.text(), /@sharpforge\/editor/);
    const entry = await fetch(new URL('/packages/editor/src/index.js', server.url));
    assert.equal(entry.status, 200);
    assert.match(await entry.text(), /export .*CodeEditor/);
    const invalid = await fetch(new URL('/%invalid.js', server.url));
    assert.equal(invalid.status, 400);
    const missing = await fetch(new URL('/not-an-editor-module.js', server.url));
    assert.equal(missing.status, 404);
  } finally { await server.close(); }
});
