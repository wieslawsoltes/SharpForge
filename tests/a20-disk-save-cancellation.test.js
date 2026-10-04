import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {DiskWorkspace} from '@sharpforge/project-system';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {sourceFileHandle} from './fixtures/a20-source-file-fixture.js';

const limits = {maxFileBytes: 1024 * 1024, maxAssemblyBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024};

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return {promise, resolve};
}

function setup(files = {'A.cs': 'original'}, hooks = {}) {
  const models = new Map();
  const handles = new Map();
  const records = [];
  for (const [path, text] of Object.entries(files)) {
    const model = new EditorModel(text, {uri: path});
    models.set(path, model);
    records.push({path, source: model.snapshot(), encoding: 'utf-8', bom: false, byteLength: text.length});
    const inner = sourceFileHandle(path, text);
    handles.set(path, {
      metrics: inner.metrics,
      get bytes() { return inner.bytes; },
      async getFile() { await hooks.read?.(path); return inner.getFile(); },
      async queryPermission() { await hooks.permission?.(path); return 'granted'; },
      async createWritable() {
        await hooks.open?.(path);
        const stream = await inner.createWritable();
        return {
          async write(bytes) { await stream.write(bytes); await hooks.write?.(path); },
          async close() { await hooks.close?.(path); await stream.close(); },
          async abort() { await stream.abort(); }
        };
      }
    });
  }
  const disk = new DiskWorkspace(records, handles, 'Sources', [], [], {...limits, readSource: hooks.readSource ?? readStudioSource});
  const change = (path, text) => {
    const model = models.get(path);
    model.applyEdits([{start: 0, end: model.length, text}]);
    return {uri: path, source: model.snapshot()};
  };
  return {disk, models, handles, change, dispose() { for (const model of models.values()) model.dispose(); }};
}

test('A20 pre-cancelled and queued-cancelled disk saves do not start a read or write', async () => {
  const gate = deferred();
  const entered = deferred();
  let reads = 0;
  const context = setup(undefined, {async read() { if (++reads === 1) { entered.resolve(); await gate.promise; } }});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(context.disk.save([context.change('A.cs', 'cancelled')], {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(reads, 0);
  const first = context.disk.save([context.change('A.cs', 'first')]);
  await entered.promise;
  const queuedController = new AbortController();
  const queued = context.disk.save([context.change('A.cs', 'queued')], {signal: queuedController.signal});
  queuedController.abort();
  gate.resolve();
  assert.deepEqual((await first).written, ['A.cs']);
  await assert.rejects(queued, {name: 'AbortError'});
  assert.equal(reads, 2);
  assert.equal(context.handles.get('A.cs').metrics.written, 1);
  assert.equal(new TextDecoder().decode(context.handles.get('A.cs').bytes), 'first');
  context.dispose();
});

test('A20 cancelling an acquired prepared baseline releases its private model and preserves the live source', async () => {
  const controller = new AbortController();
  let compared;
  const context = setup(undefined, {async readSource(file, options) {
    assert.equal(options.signal, controller.signal);
    compared = await readStudioSource(file, options);
    controller.abort();
    return compared;
  }});
  const baseline = context.disk.baseline.get('A.cs');
  await assert.rejects(context.disk.save([context.change('A.cs', 'next')], {signal: controller.signal}), {name: 'AbortError'});
  assert.throws(() => compared.model.applyEdits([{start: 0, end: 0, text: '!'}]), /disposed/);
  assert.equal(context.disk.baseline.get('A.cs'), baseline);
  assert.equal(context.models.get('A.cs').getText(), 'next');
  assert.equal(context.handles.get('A.cs').metrics.opened, 0);
  context.dispose();
});

test('A20 cancellation during permission and stream acquisition prevents any committed write', async () => {
  for (const stage of ['permission', 'open']) {
    const controller = new AbortController();
    const context = setup(undefined, {[stage]() { controller.abort(); }});
    const baseline = context.disk.baseline.get('A.cs');
    await assert.rejects(context.disk.save([context.change('A.cs', 'next')], {signal: controller.signal}), {name: 'AbortError'});
    const handle = context.handles.get('A.cs');
    assert.equal(handle.metrics.written, 0);
    assert.equal(handle.metrics.aborted, stage === 'open' ? 1 : 0);
    assert.equal(context.disk.baseline.get('A.cs'), baseline);
    assert.equal(new TextDecoder().decode(handle.bytes), 'original');
    context.dispose();
  }
});

test('A20 a mid-stream cancellation aborts before close and retains the previous baseline/version', async () => {
  const controller = new AbortController();
  const context = setup(undefined, {write() { controller.abort(); }});
  const baseline = context.disk.baseline.get('A.cs');
  const version = context.disk.getVersion('A.cs');
  await assert.rejects(context.disk.save([context.change('A.cs', 'x'.repeat(100_000))], {signal: controller.signal}), error => {
    assert.equal(error.name, 'AbortError');
    assert.deepEqual(error.written, []);
    return true;
  });
  const handle = context.handles.get('A.cs');
  assert.equal(handle.metrics.chunks, 1);
  assert.equal(handle.metrics.written, 0);
  assert.equal(handle.metrics.aborted, 1);
  assert.equal(context.disk.baseline.get('A.cs'), baseline);
  assert.equal(context.disk.getVersion('A.cs'), version);
  assert.equal(new TextDecoder().decode(handle.bytes), 'original');
  context.dispose();
});

test('A20 close is the per-file commit boundary; cancellation prevents later files and preserves exact partial written results', async () => {
  const controller = new AbortController();
  const context = setup({'A.cs': 'first', 'B.cs': 'second'}, {close(path) { if (path === 'A.cs') controller.abort(); }});
  const first = context.change('A.cs', 'FIRST');
  const second = context.change('B.cs', 'SECOND');
  const secondBaseline = context.disk.baseline.get('B.cs');
  await assert.rejects(context.disk.save([first, second], {signal: controller.signal}), error => {
    assert.equal(error.name, 'AbortError');
    assert.deepEqual(error.written, ['A.cs']);
    return true;
  });
  assert.equal(context.disk.baseline.get('A.cs'), first.source);
  assert.equal(context.disk.baseline.get('B.cs'), secondBaseline);
  assert.equal(context.handles.get('A.cs').metrics.written, 1);
  assert.equal(context.handles.get('B.cs').metrics.opened, 0);
  context.dispose();
});

test('A20 a cancellation after the final close starts does not falsely report an uncommitted file', async () => {
  const controller = new AbortController();
  const context = setup(undefined, {close() { controller.abort(); }});
  const change = context.change('A.cs', 'next');
  const report = await context.disk.save([change], {signal: controller.signal});
  assert.deepEqual(report.written, ['A.cs']);
  assert.equal(context.disk.baseline.get('A.cs'), change.source);
  assert.equal(context.handles.get('A.cs').metrics.aborted, 0);
  context.dispose();
});
