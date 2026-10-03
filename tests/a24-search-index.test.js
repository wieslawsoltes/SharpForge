import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSearchIndex, MemoryFileSystemProvider} from '@sharpforge/workspace';

const encode = value => new TextEncoder().encode(value);

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
