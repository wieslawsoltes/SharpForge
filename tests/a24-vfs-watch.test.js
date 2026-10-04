import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystemProvider, PollingFileWatcher, FileWatchCoalescer,
  observeFileSystemHandle, hashFileBytes} from '@sharpforge/workspace';

const bytes = value => new TextEncoder().encode(value);

test('A24 polling prioritizes open files and bounds each interval over a 20000-file inventory', async () => {
  const entries = new Map(Array.from({length: 20000}, (_, index) => [`File${index}.cs`,
    {path: `File${index}.cs`, name: `File${index}.cs`, type: 'file', size: 100, mtime: 1}]));
  const provider = {check: path => path, async stat(path) { return {...entries.get(path)}; },
    async readFile(path) { return bytes(path + entries.get(path).mtime); },
    async *iterateDirectory() { yield* entries.values(); }};
  const events = [];
  const watcher = new PollingFileWatcher(provider, event => events.push(event), {
    watchedPaths: ['File19999.cs'], maxStatsPerTick: 32, maxDirectoryEntriesPerTick: 40
  });
  await watcher.start({schedule: false});
  entries.get('File19999.cs').mtime = 2;
  const before = {...watcher.metrics};
  await watcher.poll();
  assert(events.some(event => event.path === 'File19999.cs' && event.type === 'changed'));
  assert(watcher.metrics.statCalls - before.statCalls <= 32);
  assert(watcher.metrics.directoryEntries - before.directoryEntries <= 40);
  watcher.dispose();
  assert.deepEqual(await watcher.poll(), []);
});

test('A24 coalescer recognizes atomic replace and suppresses only matching own-save byte hashes', async () => {
  const events = [];
  const coalescer = new FileWatchCoalescer(event => events.push(event));
  coalescer.push({type: 'deleted', path: 'a.cs'});
  coalescer.push({type: 'created', path: 'a.cs', hash: 'external'});
  coalescer.flush();
  assert.deepEqual(events.map(event => event.type), ['changed']);
  coalescer.push({type: 'created', path: '.a.tmp'});
  coalescer.push({type: 'renamed', path: 'a.cs', oldPath: '.a.tmp'});
  assert.deepEqual(coalescer.flush().map(event => event.type), ['changed']);
  const hash = await hashFileBytes(bytes('saved'));
  coalescer.markOwnWrite('a.cs', hash);
  coalescer.push({type: 'changed', path: 'a.cs', hash});
  assert.equal(coalescer.flush().length, 0);
  coalescer.markOwnWrite('a.cs', hash);
  coalescer.push({type: 'changed', path: 'a.cs', hash: 'someone-else'});
  assert.equal(coalescer.flush().length, 1);
  coalescer.dispose();
});

test('A24 FileSystemObserver chooses bounded fallback when unavailable and disposes observer subscriptions', async () => {
  assert.equal(await observeFileSystemHandle({}, () => {}, {FileSystemObserver: undefined}), null);
  let callback;
  let disconnected = false;
  class Observer {
    constructor(listener) { callback = listener; }
    async observe() {}
    disconnect() { disconnected = true; }
  }
  const events = [];
  const subscription = await observeFileSystemHandle({}, event => events.push(event), {FileSystemObserver: Observer});
  callback([{type: 'modified', relativePathComponents: ['a.cs']}]);
  assert.deepEqual(events, [{type: 'changed', path: 'a.cs'}]);
  subscription.dispose();
  assert.equal(disconnected, true);
  callback([{type: 'disappeared', relativePathComponents: ['a.cs']}]);
  assert.equal(events.length, 1);
});

test('A24 polling identifies a uniquely hashed file rename', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('before.cs', bytes('unique content'));
  const events = [];
  const watcher = new PollingFileWatcher(provider, event => events.push(event));
  await watcher.start({schedule: false});
  await provider.rename('before.cs', 'after.cs');
  await watcher.poll();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'renamed');
  assert.equal(events[0].oldPath, 'before.cs');
  assert.equal(events[0].path, 'after.cs');
  watcher.dispose();
});

test('A24 own-save acknowledgement suppresses a previously queued matching hash without hiding another writer', () => {
  const events = [];
  const coalescer = new FileWatchCoalescer(event => events.push(event));
  coalescer.push({path: 'a.cs', type: 'changed', hash: 'ours'});
  coalescer.markOwnWrite('a.cs', 'ours');
  coalescer.flush();
  assert.equal(events.length, 0);
  coalescer.push({path: 'a.cs', type: 'changed', hash: 'theirs'});
  coalescer.flush();
  assert.equal(events.length, 1);
  coalescer.dispose();
});
