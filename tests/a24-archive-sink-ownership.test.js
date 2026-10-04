import test from 'node:test';
import assert from 'node:assert/strict';
import { readZip, writeZipTo } from '@sharpforge/archive';
import { exportWorkspaceZipTo } from '@sharpforge/project-system';

function destination(onWrite = async () => {}) {
  const state = { chunks: [], aborts: [], closes: 0 };
  const stream = new WritableStream({
    async write(bytes) { state.chunks.push(bytes.slice()); await onWrite(bytes); },
    close() { state.closes++; },
    abort(error) { state.aborts.push(error); }
  });
  return { stream, state };
}

function concatenate(chunks) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

test('ZIP preflight aborts and releases an accepted stream for malformed names and invalid options', async () => {
  const valid = [{ path: 'valid.txt', text: 'text' }];
  const cases = [
    [[{ path: '../escape.txt', text: 'text' }], {}],
    [[{ path: 'A.txt', text: 'a' }, { path: 'a.txt', text: 'b' }], {}],
    [valid, { maxEntries: 0 }],
    [valid, { compression: 'unsupported' }]
  ];
  for (const [records, options] of cases) {
    const { stream, state } = destination();
    let failure;
    await assert.rejects(writeZipTo(records, stream, options), error => { failure = error; return true; });
    assert.deepEqual(state.aborts, [failure]);
    assert.equal(state.chunks.length, 0);
    assert.equal(state.closes, 0);
    assert.equal(stream.locked, false);
  }
});

test('workspace manifest validation aborts and releases its accepted stream before any ZIP bytes', async () => {
  for (const settings of [{ entry: 'Missing.csproj' }, { name: '' }]) {
    const { stream, state } = destination();
    let failure;
    await assert.rejects(exportWorkspaceZipTo({ records: [{ path: 'App.csproj', text: '<Project />' }], settings }, stream),
      error => { failure = error; return true; });
    assert.deepEqual(state.aborts, [failure]);
    assert.equal(state.chunks.length, 0);
    assert.equal(state.closes, 0);
    assert.equal(stream.locked, false);
  }
});

test('ZIP and workspace export leave a stream locked by another writer under that writer ownership', async () => {
  for (const write of [
    stream => writeZipTo([{ path: '../escape.txt', text: 'text' }], stream),
    stream => exportWorkspaceZipTo({ records: [], settings: { name: '' } }, stream)
  ]) {
    const { stream, state } = destination();
    const owner = stream.getWriter();
    try {
      await assert.rejects(write(stream), TypeError);
      assert.equal(stream.locked, true);
      assert.deepEqual(state.aborts, []);
      await owner.write(Uint8Array.of(42));
      assert.deepEqual(state.chunks, [Uint8Array.of(42)]);
      await owner.close();
      assert.equal(state.closes, 1);
    } finally { owner.releaseLock(); }
  }
});

test('accepted writer adapters release once and preserve the validation error when abort also fails', async () => {
  for (const write of [
    writer => writeZipTo([{ path: '../escape.txt', text: 'text' }], writer),
    writer => exportWorkspaceZipTo({ records: [], settings: { name: '' } }, writer)
  ]) {
    const abortError = new Error('Destination abort failed');
    let aborts = 0;
    let releases = 0;
    const writer = { write() { assert.fail('preflight must finish before writing'); },
      abort() { aborts++; throw abortError; }, releaseLock() { releases++; } };
    await assert.rejects(write(writer), error => error !== abortError && error.abortError === abortError);
    assert.equal(aborts, 1);
    assert.equal(releases, 1);
  }
});

test('ZIP and workspace writers preserve backpressure, close once and release their successful destination', async () => {
  for (const write of [
    (records, stream) => writeZipTo(records, stream, { compression: 'deflate' }),
    (records, stream) => exportWorkspaceZipTo({ records }, stream, { compression: 'deflate' })
  ]) {
    let release;
    let started;
    let pulls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const firstWrite = new Promise(resolve => { started = resolve; });
    const { stream, state } = destination(async () => { started(); await gate; });
    const bytes = new TextEncoder().encode('backpressure keeps the producer idle until its header is written');
    const records = [{ path: 'Example.txt', stream: async function* () { pulls++; yield bytes; } }];
    const pending = write(records, stream);
    try {
      await firstWrite;
      assert.equal(pulls, 0);
      assert.equal(state.chunks.length, 1);
      assert.equal(stream.locked, true);
    } finally { release(); }
    await pending;
    assert.equal(pulls, 1);
    assert.equal(state.closes, 1);
    assert.deepEqual(state.aborts, []);
    assert.equal(stream.locked, false);
    assert.deepEqual(readZip(concatenate(state.chunks)).find(entry => entry.path === 'Example.txt').bytes, bytes);
  }
});
