import test from 'node:test';
import assert from 'node:assert/strict';
import {TextBuffer} from '@sharpforge/text';
import {encodeWorkspaceFile} from '@sharpforge/project-system';
import {saveStudioSourceAs} from '../apps/studio/workbench/source-save-as.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return {promise, resolve, reject};
}

function captured(text, metadata = {}) {
  const buffer = new TextBuffer(text, {uri: 'src/Program.cs', version: 7, ...metadata});
  const original = buffer.snapshot();
  const reads = {count: 0, maximum: 0};
  const source = Object.freeze({
    length: original.length, uri: original.uri, version: original.version,
    get text() { throw new Error('Save As must not materialize source.text'); },
    getText(start, end) {
      assert.ok(end - start <= 65_537, 'Read windows retain at most one extra surrogate code unit');
      reads.count++;
      reads.maximum = Math.max(reads.maximum, end - start);
      return original.getText(start, end);
    }
  });
  const snapshot = Object.freeze(Object.defineProperties({uri: buffer.uri, version: buffer.version,
    encoding: buffer.encoding, bom: buffer.bom}, {
    source: {value: source},
    length: {value: source.length},
    text: {enumerable: true, get() { throw new Error('Save As must not evaluate the captured text getter'); }}
  }));
  return {snapshot, source, buffer, reads, original};
}

function outputStream({write, close, abort, retain = true} = {}) {
  const metrics = {writes: 0, closed: 0, aborted: 0, bytes: 0, chunks: [], reasons: []};
  const stream = {
    async write(bytes) {
      metrics.writes++;
      metrics.bytes += bytes.byteLength;
      if (retain) metrics.chunks.push(bytes.slice());
      await write?.(bytes, metrics);
    },
    async close() { metrics.closed++; await close?.(); },
    async abort(reason) { metrics.aborted++; metrics.reasons.push(reason); await abort?.(reason); }
  };
  return {stream, metrics, bytes: () => new Uint8Array(Buffer.concat(metrics.chunks))};
}

function nativeWindow(stream, name = 'Program.cs') {
  const handle = {name, async createWritable() { return stream; }};
  return {handle, window: {showSaveFilePicker: () => Promise.resolve(handle)}};
}

test('Save As invokes the picker during the calling gesture before any source read', async () => {
  const input = captured('original\r\n', {encoding: 'utf-16be', bom: true});
  const picker = deferred();
  const output = outputStream();
  const {handle} = nativeWindow(output.stream, 'Chosen.cs');
  let calls = 0;
  const mutable = Object.defineProperties({uri: input.snapshot.uri, version: 7, encoding: 'utf-16be', bom: true}, {
    source: {value: input.source, writable: true},
    text: {enumerable: true, get() { throw new Error('The wrapper must not be enumerated or read'); }}
  });
  const saving = saveStudioSourceAs(mutable, {window: {showSaveFilePicker(options) {
    calls++;
    assert.deepEqual(options, {suggestedName: 'Program.cs'});
    assert.equal(input.reads.count, 0);
    return picker.promise;
  }}});
  assert.equal(calls, 1);
  assert.equal(input.reads.count, 0);
  input.buffer.applyEdits([{start: 0, end: input.buffer.length, text: 'later'}]);
  mutable.source = input.buffer.snapshot();
  mutable.uri = 'Other.cs';
  mutable.version = 8;
  mutable.encoding = 'utf-8';
  mutable.bom = false;
  picker.resolve(handle);
  const result = await saving;
  assert.equal(result.ok, true);
  assert.equal(result.handle, handle);
  assert.equal(result.source, input.source);
  assert.equal(result.uri, 'src/Program.cs');
  assert.equal(result.version, 7);
  assert.equal(result.name, 'Chosen.cs');
  assert.deepEqual(output.bytes(), encodeWorkspaceFile({path: 'Program.cs', text: 'original\r\n', encoding: 'utf-16be', bom: true}));
  assert.equal(result.byteLength, output.metrics.bytes);
  assert.equal(output.metrics.closed, 1);
  assert.equal(output.metrics.aborted, 0);
  assert.equal(input.original.statistics.textMaterialized, false);
  input.buffer.dispose();
});

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`Save As preserves ${encoding}, BOM, split surrogate pairs, and CRLF`, async () => {
    const text = 'a'.repeat(65_535) + '😀\r\n界𠀀!';
    const input = captured(text, {encoding, bom: true});
    const output = outputStream();
    const result = await saveStudioSourceAs(input.snapshot, nativeWindow(output.stream));
    assert.equal(result.ok, true);
    assert.equal(result.encoding, encoding);
    assert.equal(result.bom, true);
    assert.deepEqual(output.bytes(), encodeWorkspaceFile({path: 'Program.cs', text, encoding, bom: true}));
    assert.equal(input.reads.maximum, 65_537);
    assert.equal(input.original.statistics.textMaterialized, false);
    input.buffer.dispose();
  });
}

test('Save As writes the BOM for empty sources and supports captured legacy text data properties', async () => {
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
    const output = outputStream();
    const result = await saveStudioSourceAs({uri: 'Empty.cs', text: '', encoding, bom: true}, nativeWindow(output.stream));
    assert.equal(result.ok, true);
    assert.deepEqual(output.bytes(), encodeWorkspaceFile({path: 'Empty.cs', text: '', encoding, bom: true}));
  }
});

test('Save As streams an actual 200 MiB ASCII source without retaining or reading whole text', async () => {
  const length = 200 * 1024 * 1024;
  const input = captured('a'.repeat(length));
  let yielded = false;
  const output = outputStream({retain: false, write(bytes, metrics) {
    assert.ok(bytes.byteLength <= 65_536);
    assert.ok(bytes.every(value => value === 97));
    if (metrics.writes === 1) setTimeout(() => { yielded = true; }, 0);
    if (metrics.writes === 2) assert.equal(yielded, true, 'A synchronous sink must still yield between source chunks');
  }});
  const result = await saveStudioSourceAs(input.snapshot, nativeWindow(output.stream));
  assert.equal(result.ok, true);
  assert.equal(result.byteLength, length);
  assert.equal(output.metrics.bytes, length);
  assert.equal(output.metrics.writes, length / 65_536);
  assert.equal(output.metrics.closed, 1);
  assert.equal(output.metrics.aborted, 0);
  assert.equal(output.metrics.chunks.length, 0);
  assert.ok(input.reads.maximum <= 65_537);
  assert.equal(input.original.statistics.textMaterialized, false);
  input.buffer.dispose();
});

test('a cancelled native picker leaves the source unread and does not initiate an export', async () => {
  const input = captured('text');
  let downloads = 0;
  const result = await saveStudioSourceAs(input.snapshot, {window: {
    showSaveFilePicker() { throw new DOMException('Dismissed', 'AbortError'); }
  }, download() { downloads++; }});
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(input.reads.count, 0);
  assert.equal(downloads, 0);
  input.buffer.dispose();
});

test('pre-cancellation skips the picker and cancellation while acquiring a stream aborts it unread', async () => {
  const input = captured('text');
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const first = await saveStudioSourceAs(input.snapshot, {signal: controller.signal,
    window: {showSaveFilePicker() { calls++; throw new Error('Must not be called'); }}});
  assert.equal(first.cancelled, true);
  assert.equal(calls, 0);
  const pending = deferred();
  const entered = deferred();
  const next = new AbortController();
  const output = outputStream();
  const saving = saveStudioSourceAs(input.snapshot, {signal: next.signal, window: {
    showSaveFilePicker: () => Promise.resolve({createWritable() { entered.resolve(); return pending.promise; }})
  }});
  await entered.promise;
  next.abort();
  pending.resolve(output.stream);
  assert.equal((await saving).cancelled, true);
  assert.equal(output.metrics.aborted, 1);
  assert.equal(output.metrics.closed, 0);
  assert.equal(input.reads.count, 0);
  input.buffer.dispose();
});

test('cancellation aborts a pending native write and never commits or writes a second chunk', async () => {
  const input = captured('x'.repeat(130_000));
  const controller = new AbortController();
  const pending = deferred();
  const entered = deferred();
  const output = outputStream({write() { entered.resolve(); return pending.promise; }, abort(reason) { pending.reject(reason); }});
  const saving = saveStudioSourceAs(input.snapshot, {...nativeWindow(output.stream), signal: controller.signal});
  await entered.promise;
  controller.abort();
  const result = await saving;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(output.metrics.writes, 1);
  assert.equal(output.metrics.aborted, 1);
  assert.equal(output.metrics.closed, 0);
  input.buffer.dispose();
});

test('a native save is not confirmed until close completes; late cancellation does not undo a committed save', async () => {
  const closing = deferred();
  const entered = deferred();
  const controller = new AbortController();
  const output = outputStream({close() { entered.resolve(); return closing.promise; }});
  let settled = false;
  const saving = saveStudioSourceAs({uri: 'A.cs', text: 'text'}, {...nativeWindow(output.stream), signal: controller.signal});
  saving.then(() => { settled = true; });
  await entered.promise;
  assert.equal(settled, false);
  controller.abort();
  closing.resolve();
  assert.equal((await saving).ok, true);
  assert.equal(output.metrics.aborted, 0);
});

for (const phase of ['picker', 'createWritable', 'write', 'close']) {
  test(`a ${phase} failure rejects, never exports, and aborts an acquired native stream`, async () => {
    const failure = new DOMException(`${phase} failed`, phase === 'picker' ? 'SecurityError' : 'NotAllowedError');
    const output = outputStream({[phase]() { throw failure; }});
    const handle = {async createWritable() { if (phase === 'createWritable') throw failure; return output.stream; }};
    let downloads = 0;
    await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'text'}, {window: {
      showSaveFilePicker() { if (phase === 'picker') throw failure; return Promise.resolve(handle); }
    }, download() { downloads++; }}), error => error === failure);
    assert.equal(output.metrics.aborted, phase === 'write' || phase === 'close' ? 1 : 0);
    assert.equal(downloads, 0);
  });
}

test('encoded output caps, progress errors, and failed cleanup remain explicit failures', async () => {
  const output = outputStream();
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'ééé', bom: true},
    {...nativeWindow(output.stream), maxBytes: 6}), /Source output byte limit exceeded/);
  assert.equal(output.metrics.writes, 0);
  assert.equal(output.metrics.aborted, 1);
  assert.equal(output.metrics.closed, 0);
  const progress = new Error('Progress callback failed');
  const next = outputStream();
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'text'}, {...nativeWindow(next.stream),
    async onProgress() { throw progress; }}), error => error === progress);
  assert.equal(next.metrics.aborted, 1);
  const failedWrite = new Error('write failed');
  const failedAbort = new Error('abort failed');
  const broken = outputStream({write() { throw failedWrite; }, abort() { throw failedAbort; }});
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'text'}, nativeWindow(broken.stream)), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failedWrite, failedAbort]);
    return true;
  });
});

test('a byte cap after a completed chunk aborts staged output and does not close the destination', async () => {
  const input = captured('é'.repeat(70_000));
  const output = outputStream({retain: false});
  await assert.rejects(saveStudioSourceAs(input.snapshot, {...nativeWindow(output.stream), maxBytes: 135_000}),
    /Source output byte limit exceeded/);
  assert.equal(output.metrics.writes, 1);
  assert.equal(output.metrics.aborted, 1);
  assert.equal(output.metrics.closed, 0);
  input.buffer.dispose();
});

test('invalid native handles and streams report explicit errors, with cleanup when available', async () => {
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'text'}, {
    window: {showSaveFilePicker: async () => null}
  }), {code: 'SFSTUDIO_SAVE_HANDLE'});
  let aborted = 0;
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'text'}, nativeWindow({
    async abort(reason) { aborted++; assert.equal(reason.code, 'SFSTUDIO_SAVE_STREAM'); }
  })), {code: 'SFSTUDIO_SAVE_STREAM'});
  assert.equal(aborted, 1);
});

for (const availability of ['no picker', 'read-only handle', 'unsupported writable']) {
  test(`download fallback with ${availability} preserves binary encoding but cannot confirm a save`, async () => {
    const input = captured('line\r\n界😀', {encoding: 'utf-16le', bom: true});
    const window = availability === 'no picker' ? {} : {showSaveFilePicker: async () => availability === 'read-only handle' ? {} : {
      async createWritable() { throw new DOMException('Unsupported', 'NotSupportedError'); }
    }};
    const downloads = [];
    const result = await saveStudioSourceAs(input.snapshot, {window,
      download(name, blob, type) { downloads.push({name, blob, type}); }});
    assert.equal(result.ok, false);
    assert.equal(result.exported, true);
    assert.equal(result.source, input.source);
    assert.equal(downloads.length, 1);
    const {name, blob, type} = downloads[0];
    assert.equal(name, 'Program.cs');
    assert.ok(blob instanceof Blob);
    assert.equal(type, 'text/plain;charset=utf-16le');
    assert.equal(blob.type, type);
    assert.equal(blob.size, result.byteLength);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),
      encodeWorkspaceFile({path: 'Program.cs', text: 'line\r\n界😀', encoding: 'utf-16le', bom: true}));
    assert.equal(input.original.statistics.textMaterialized, false);
    input.buffer.dispose();
  });
}

test('download cancellation and unavailable hosts reject or cancel before falsely claiming an export', async () => {
  const input = captured('text');
  await assert.rejects(saveStudioSourceAs(input.snapshot, {window: {}}), {code: 'SFSTUDIO_SAVE_UNAVAILABLE'});
  assert.equal(input.reads.count, 0);
  const denied = await saveStudioSourceAs(input.snapshot, {window: {}, download: () => false});
  assert.equal(denied.ok, false);
  assert.equal(denied.exported, false);
  await assert.rejects(saveStudioSourceAs(input.snapshot, {window: {}, download() { throw new Error('Download blocked'); }}), /Download blocked/);
  let downloads = 0;
  const controller = new AbortController();
  const stopped = await saveStudioSourceAs(input.snapshot, {window: {}, signal: controller.signal,
    download() { downloads++; }, onProgress() { controller.abort(); }});
  assert.equal(stopped.cancelled, true);
  assert.equal(downloads, 0);
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: '界界'}, {window: {}, maxBytes: 5,
    download() { downloads++; }}), /Source output byte limit exceeded/);
  assert.equal(downloads, 0);
  input.buffer.dispose();
});

test('the browser fallback uses a binary Blob URL and removes its temporary download link', async () => {
  const events = [];
  const link = {click() { events.push('click'); }, remove() { events.push('remove'); }};
  let release;
  let binary;
  const window = {Blob, document: {
    createElement(tag) { assert.equal(tag, 'a'); return link; },
    body: {appendChild(child) { assert.equal(child, link); events.push('append'); }}
  }, URL: {
    createObjectURL(blob) { binary = blob; events.push('url'); return 'blob:captured-source'; },
    revokeObjectURL(url) { assert.equal(url, 'blob:captured-source'); events.push('revoke'); }
  }, setTimeout(callback, delay) { assert.equal(delay, 1000); release = callback; }};
  const result = await saveStudioSourceAs({uri: 'file:///repo/Hello%20World.cs', text: 'text'}, {window});
  assert.equal(result.ok, false);
  assert.equal(result.exported, true);
  assert.equal(link.download, 'Hello World.cs');
  assert.equal(link.href, 'blob:captured-source');
  assert.equal(link.hidden, true);
  assert.equal(await binary.text(), 'text');
  assert.deepEqual(events, ['url', 'append', 'click', 'remove']);
  release();
  assert.equal(events.at(-1), 'revoke');
});

test('invalid source metadata and mutable or lazy-only sources fail before a picker opens', async () => {
  let calls = 0;
  const options = {window: {showSaveFilePicker() { calls++; throw new Error('Unexpected picker'); }}};
  const lazy = {uri: 'A.cs', get text() { throw new Error('Lazy text must not be evaluated'); }};
  for (const snapshot of [null, lazy, {source: {length: 1, getText: () => 'x'}},
    {uri: 'A.cs', text: 'x', encoding: 'latin-1'}, {uri: 'A.cs', text: 'x', bom: 'true'},
    {uri: 'A.cs', text: 'x', version: -1}]) await assert.rejects(saveStudioSourceAs(snapshot, options));
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'long'}, {...options, maxBytes: 3}), RangeError);
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: '', bom: true}, {...options, maxBytes: 2}), RangeError);
  await assert.rejects(saveStudioSourceAs({uri: 'A.cs', text: 'x'}, {...options, download: true}), TypeError);
  assert.equal(calls, 0);
});

test('suggested names use URI basenames, including Windows paths and empty trailing components', async () => {
  for (const [uri, expected] of [['C:\\source\\Demo.cs', 'Demo.cs'], ['src/', 'Program.cs'], ['src/A?.cs', 'A_.cs']]) {
    let name;
    const result = await saveStudioSourceAs({uri, text: ''}, {window: {}, download(value) { name = value; }});
    assert.equal(name, expected);
    assert.equal(result.uri, uri);
  }
});
