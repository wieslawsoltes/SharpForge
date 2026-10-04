import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystemProvider, WorkspaceSearchIndex} from '@sharpforge/workspace';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const bytes = value => new TextEncoder().encode(value);

async function fixture(Index = WorkspaceSearchIndex) {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('A.cs', bytes('needle first\nneedle second'));
  const diagnostics = [];
  const index = new Index(provider, {onDiagnostic: value => diagnostics.push(value)});
  index.upsert({path: 'A.cs', version: 7});
  return {provider, index, diagnostics};
}

for (const change of ['replacement', 'invalidation', 'delete']) {
  test('streamed content matches stop at concurrent ' + change + ' without borrowing a newer version', async () => {
    const {provider, index, diagnostics} = await fixture();
    const stream = index.findText('needle');
    const first = await stream.next();
    assert.equal(first.value.version, 7);
    assert.equal(first.value.preview, 'needle first');
    await provider.writeFile('A.cs', bytes('updated needle'));
    if (change === 'replacement') index.upsert({path: 'A.cs', version: 8});
    else if (change === 'invalidation') index.invalidate('A.cs');
    else index.remove('A.cs');
    assert.deepEqual(await stream.next(), {done: true, value: undefined});
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, 'SFSEARCH001');
    assert.equal(first.value.version, 7);
    if (change !== 'delete') {
      const current = await index.findInFiles('updated');
      assert.equal(current.matches.length, 1);
      assert.equal(current.matches[0].version, change === 'replacement' ? 8 : 7);
      assert.equal(current.matches[0].preview, 'updated needle');
    }
    index.dispose();
  });
}

test('a cache hit rechecks its captured entry before the first streamed result', async () => {
  const {index, diagnostics} = await fixture();
  await index.text('A.cs');
  const stream = index.findText('needle');
  const first = stream.next();
  index.upsert({path: 'A.cs', version: 8});
  assert.deepEqual(await first, {done: true, value: undefined});
  assert.equal(diagnostics.length, 1);
  assert.equal(index.metrics.contentReads, 1);
  index.dispose();
});

test('Find in Files retains the matched version across asynchronous result handoff', async () => {
  class HandoffIndex extends WorkspaceSearchIndex {
    async *findText(query, options) {
      for await (const match of super.findText(query, options)) {
        this.upsert({path: match.path, version: 99});
        yield match;
      }
    }
  }
  const {index} = await fixture(HandoffIndex);
  const result = await index.findInFiles('needle');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].version, 7);
  assert.equal(index.entries.get('A.cs').version, 99);
  index.dispose();
});

test('one content search snapshots indexed membership without rereading replaced or newly inserted paths', async () => {
  const {provider, index} = await fixture();
  const stream = index.findText('needle');
  assert.equal((await stream.next()).value.path, 'A.cs');
  await provider.writeFile('B.cs', bytes('needle new file'));
  index.upsert({path: 'B.cs', version: 1});
  index.upsert({path: 'A.cs', version: 8});
  assert.equal((await stream.next()).done, true);
  const current = await index.findInFiles('needle');
  assert.deepEqual(current.matches.map(match => [match.uri, match.version]), [['B.cs', 1], ['A.cs', 8], ['A.cs', 8]]);
  index.dispose();
});

for (const action of ['abort', 'dispose']) {
  test(action + ' between yielded content matches stops the stream immediately', async () => {
    const {index} = await fixture();
    const controller = new AbortController();
    const stream = index.findText('needle', {signal: controller.signal});
    assert.equal((await stream.next()).done, false);
    if (action === 'abort') controller.abort();
    else index.dispose();
    await assert.rejects(stream.next(), error => action === 'abort' ? error.name === 'AbortError' : error.code === 'Disposed');
    index.dispose();
  });
}

test('disposing a search during its final pending file read rejects the overall Find in Files request', async () => {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', bytes('needle'));
  const index = new WorkspaceSearchIndex(provider);
  index.upsert({path: 'A.cs', version: 1});
  const gate = provider.pause('read');
  const pending = index.findInFiles('needle');
  const rejected = assert.rejects(pending, error => error.code === 'Disposed');
  await gate.entered;
  index.dispose();
  gate.release();
  await rejected;
  assert.equal(index.contentBytes, 0);
});
