import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyDocumentStore, WorkspaceSearchIndex, MemoryFileSystemProvider, Workspace} from '@sharpforge/workspace';
import {LazyExplorerTree} from '../packages/project-system/src/explorer/lazy-tree.js';

const encode = value => new TextEncoder().encode(value);

test('A24 5000 closed files hold metadata only and loaded documents obey the byte budget', async () => {
  let reads = 0;
  const provider = {check: path => path, async readFile(path) { reads++; return encode('content ' + path); }};
  const evicted = [];
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 100, onEvict: path => evicted.push(path)});
  store.registerAll(Array.from({length: 5000}, (_, index) => ({path: `F${index}.cs`, size: 10})));
  assert.equal(store.size, 5000);
  assert.equal(store.loaded.size, 0);
  assert.equal(reads, 0);
  assert.throws(() => store.register({path: 'unbudgeted.cs', text: 'x'.repeat(1000)}), /metadata only/);
  assert.throws(() => store.registerAll([{path: 'unbudgeted.bin', bytes: new Uint8Array(1000)}]), /metadata only/);
  await store.load('F1.cs', {pin: true});
  await store.load('F2.cs');
  await store.load('F3.cs');
  assert(store.loaded.has('F1.cs'));
  assert(store.loadedBytes <= 100);
  assert(evicted.includes('F2.cs'));
  store.update('F1.cs', 'dirty');
  assert.equal(store.unload('F1.cs'), false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.load('F4.cs', {signal: controller.signal}), error => error.name === 'AbortError');
  const before = store.size;
  assert.throws(() => store.registerAll([{path: 'New.cs'}, {path: 'F1.cs'}]));
  assert.equal(store.size, before);
  store.dispose();
  await assert.rejects(store.load('F1.cs'), error => error.code === 'Disposed');
});

test('A24 Workspace materializes SourceText and syntax only for opened or selected compilation inputs', async () => {
  let reads = 0;
  const provider = {check: path => path, async readFile(path) { reads++; return encode('class ' + path.slice(0, -3) + ' {}'); }};
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 1024});
  store.registerAll(Array.from({length: 5000}, (_, index) => ({path: `F${index}.cs`, size: 15, compile: index === 0})));
  const workspace = new Workspace({documentStore: store, maxWorkspaceBytes: 1024});
  assert.equal(workspace.documents.size, 0);
  assert.equal(reads, 0);
  await workspace.openFile('F1.cs', {pin: false});
  assert.equal(workspace.documents.size, 1);
  assert.equal(workspace.documents.get('F1.cs').parsed, null);
  workspace.syntax('F1.cs');
  assert.equal(workspace.metrics.parsedDocuments, 1);
  assert.equal(workspace.closeFile('F1.cs'), true);
  assert.equal(workspace.documents.size, 0);
  const firstVersion = workspace.versions.get('F1.cs');
  await workspace.compileAsync();
  assert.deepEqual([...workspace.documents.keys()], ['F0.cs']);
  assert.equal(reads, 2);
  assert(workspace.documents.get('F0.cs').parsed);
  await workspace.openFile('F1.cs');
  assert(workspace.documents.get('F1.cs').source.version > firstVersion);
  workspace.dispose();
  store.dispose();
});

test('A24 file admission failure retains the previous dirty buffer and invalidation rejects stale async data', async () => {
  let resolve;
  const provider = {check: path => path, readFile: () => new Promise(complete => { resolve = complete; })};
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 30});
  store.register({path: 'a.cs', size: 1});
  const pending = store.load('a.cs');
  store.register({path: 'a.cs', size: 2});
  resolve(encode('text'));
  await assert.rejects(pending, error => error.code === 'Conflict');
  store.admit('a.cs', {path: 'a.cs', text: 'dirty', bytes: encode('dirty')}, {dirty: true});
  assert.throws(() => store.admit('a.cs', {text: 'x'.repeat(100)}), error => error.code === 'QuotaExceeded');
  assert.equal(store.loaded.get('a.cs').record.text, 'dirty');
});

test('A24 10000-file folder materializes pages and bounds visible row count', async () => {
  const model = new LazyExplorerTree({files: Array.from({length: 10000}, (_, index) => ({path: `src/File${index}.cs`, lazy: true}))});
  assert.equal(model.root.children.length, 0);
  const root = await model.root.loadChildren();
  assert.equal(root.nodes[0].childCount, 10000);
  const first = await root.nodes[0].loadChildren({limit: 64});
  assert.equal(first.nodes.length, 64);
  assert.equal(first.total, 10000);
  assert.equal(first.hasMore, true);
  const last = await root.nodes[0].loadChildren({offset: 9990, limit: 64});
  assert.equal(last.nodes.length, 10);
  assert.equal(last.hasMore, false);
  const viewport = model.window({count: 10000, scrollTop: 24000, viewportHeight: 480});
  assert(viewport.count <= 32);
  assert(viewport.before > 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model.loadChildren('src', {signal: controller.signal}), error => error.name === 'AbortError');
  await assert.rejects(model.loadChildren('src', {limit: 1001}));
  model.dispose();
});

test('A24 deferred explorer construction materializes no files before cancellable expansion', async () => {
  const files = Array.from({length: 10000}, (_, index) => ({path: `src/F${index}.cs`}));
  const model = new LazyExplorerTree({files, deferIndex: true});
  assert.equal(model.files.size, 0);
  assert.equal(model.root.childCount, null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(model.root.loadChildren({signal: controller.signal}), error => error.name === 'AbortError');
  assert.equal(model.files.size, 0);
  const page = await model.root.loadChildren();
  assert.equal(page.nodes[0].childCount, 10000);
  assert.equal(model.root.childCount, 1);
  model.dispose();
});

test('A24 search indexes 20000 paths, streams first results, observes changes and cancels', async () => {
  const contents = new Map([['File0.cs', 'needle one\nsecond needle\n'], ['File19999.cs', 'far needle']]);
  let reads = 0;
  const provider = {check: path => path,
    async readFile(path) { reads++; return encode(contents.get(path) ?? 'class C {}'); },
    async stat(path) { return {path, type: 'file', size: (contents.get(path) ?? '').length}; }};
  const index = new WorkspaceSearchIndex(provider, {maxContentBytes: 128});
  await index.addFiles(Array.from({length: 20000}, (_, value) => ({path: `File${value}.cs`, size: 100})));
  assert.equal(reads, 0);
  const paths = await index.searchPaths('F19999', {limit: 10});
  assert(paths.some(result => result.path === 'File19999.cs'));
  const iterator = index.findText('needle', {limit: 3});
  const first = await iterator.next();
  assert.equal(first.value.path, 'File0.cs');
  assert.equal(first.value.line, 1);
  assert.equal(reads, 1);
  await iterator.return();
  contents.set('File0.cs', 'updated needle');
  await index.onWatchEvent({type: 'changed', path: 'File0.cs'});
  const changed = [];
  for await (const result of index.findText('updated', {paths: ['File0.cs']})) changed.push(result);
  assert.equal(changed[0].column, 1);
  await index.onWatchEvent({type: 'renamed', oldPath: 'File0.cs', path: 'Renamed.cs'});
  assert(!index.entries.has('File0.cs'));
  assert(index.entries.has('Renamed.cs'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(index.searchPaths('File', {signal: controller.signal}), error => error.name === 'AbortError');
  assert(index.contentBytes <= 128);
  index.dispose();
});

test('A24 content search skips binaries and reports inaccessible files', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('a.txt', encode('needle needleTwo needle'));
  await provider.writeFile('opaque.bin', Uint8Array.of(0, 255));
  const diagnostics = [];
  const index = new WorkspaceSearchIndex(provider, {onDiagnostic: diagnostic => diagnostics.push(diagnostic)});
  await index.addFiles([{path: 'a.txt'}, {path: 'opaque.bin'}, {path: 'missing.cs'}]);
  const found = [];
  for await (const result of index.findText('needle', {wholeWord: true})) found.push(result);
  assert.equal(found.length, 2);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].path, 'missing.cs');
});

test('A24 indexed Find in Files preserves LanguageService offsets, result limits, Unicode boundaries and versions', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('a.cs', encode('😀\nneedle needleTwo needle\u0301 needle'));
  const index = new WorkspaceSearchIndex(provider);
  await index.addFiles([{path: 'a.cs', version: 7, text: 'not retained in metadata'}]);
  assert.equal(index.entries.get('a.cs').text, undefined);
  const result = await index.findInFiles('needle', {wholeWord: true, maxMatches: 1});
  assert.equal(result.matches.length, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.scannedFiles, 1);
  assert.deepEqual(result.matches[0], {uri: 'a.cs', start: 3, end: 9, version: 7, line: 1, character: 0,
    preview: 'needle needleTwo needle\u0301 needle'});
  const full = await index.findInFiles('needle', {wholeWord: true});
  assert.equal(full.matches.length, 2);
  assert.equal(full.truncated, false);
  assert.deepEqual(await index.findInFiles(''), {matches: [], truncated: false, scannedFiles: 0});
  await assert.rejects(index.findInFiles('x', {maxMatches: 10001}), RangeError);
  index.dispose();
});
