import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory, WorkspaceImportReport, GitIgnoreMatcher, PathPolicy} from '@sharpforge/project-system';
import {TestDirectoryHandle, TestFileHandle} from './support/a24-fsa.js';

test('A24 B03 folder open reports oversized and reserved paths without aborting usable files', async () => {
  const root = new TestDirectoryHandle();
  await root.put('Program.cs', 'class Program {}');
  await root.put('con.txt', 'reserved');
  await root.put('large.bin', new Uint8Array(200));
  const disk = await readDirectory(root, {maxFileBytes: 100});
  assert.equal(disk.records.length, 1);
  assert.equal(disk.records[0].path, 'Program.cs');
  assert(disk.skipped.some(outcome => outcome.path === 'large.bin' && outcome.reason === 'file-too-large'));
  assert(disk.skipped.some(outcome => outcome.path === 'con.txt' && outcome.reason === 'non-portable-path'));
  assert.equal(root.children.get('large.bin').reads, 0);
});

test('A24 coherent disk snapshot adoption rebuilds indexes without advancing retained hashes or admitting invalid partial state', async () => {
  const root = new TestDirectoryHandle();
  await root.put('A.cs', 'first');
  await root.put('B.cs', 'second');
  const disk = await readDirectory(root);
  const original = disk.baselineHashes.get('A.cs');
  disk.adoptRecords([{path: 'A.cs', text: 'changed'}, {path: 'new.cs', size: 10, lazy: true}],
    {folders: ['Empty'], report: {outcomes: [{path: 'con.txt', reason: 'non-portable-path'}]}});
  assert.equal(disk.record('a.cs').text, 'changed');
  assert.equal(disk.positions.get('a.cs'), 0);
  assert.equal(disk.baselineHashes.get('A.cs'), original);
  assert.equal(disk.baselineHashes.has('B.cs'), false);
  assert.equal(disk.loadedBytes, 7);
  assert.equal(disk.canonicalPath('empty/New.cs'), 'Empty/New.cs');
  const before = disk.records;
  assert.throws(() => disk.adoptRecords([{path: 'A.cs', lazy: true}, {path: 'a.cs', lazy: true}]), error => error.code === 'AlreadyExists');
  assert.equal(disk.records, before);
  assert.throws(() => disk.adoptRecords([{path: 'A.cs', text: 'unbudgeted', lazy: true}]), /cannot retain contents/);
  assert.equal(disk.records, before);
  assert.equal(disk.skipped[0].path, 'con.txt');
});

test('A24 20000-file scan reads project bytes only; content is loaded explicitly and scan cancellation is atomic', async () => {
  const root = new TestDirectoryHandle();
  for (let index = 0; index < 19999; index++) {
    const name = `Source${index}.cs`;
    root.children.set(name, new TestFileHandle(name, 'class C' + index + '{}'));
  }
  const project = await root.put('App.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>');
  const disk = await readDirectory(root);
  assert.equal(disk.records.length, 20000);
  assert.equal(disk.lazy, true);
  assert.equal(disk.records.filter(record => record.lazy).length, 19999);
  assert.equal(project.reads, 1);
  assert.equal([...root.children.values()].reduce((count, handle) => count + handle.reads, 0), 1);
  const loaded = await disk.load('Source10.cs');
  assert.equal(loaded.text, 'class C10{}');
  assert.equal(loaded.lazy, false);
  assert.equal([...root.children.values()].reduce((count, handle) => count + handle.reads, 0), 2);
  const controller = new AbortController();
  await assert.rejects(readDirectory(root, {signal: controller.signal, onProgress() { controller.abort(); }}), error => error.name === 'AbortError');
  assert.equal(disk.records.length, 20000);
});

test('A24 NFC/NFD/case collisions and gitignore decisions are individually visible', async () => {
  const report = new WorkspaceImportReport();
  assert.equal(report.admit('Program.CS'), 'Program.CS');
  assert.equal(report.admit('program.cs'), null);
  assert.equal(report.admit('é.cs'), 'é.cs');
  assert.equal(report.admit('e\u0301.cs'), null);
  assert.equal(report.skipped.length, 2);
  const ignored = new GitIgnoreMatcher('bin/\n*.tmp\n!keep.tmp\n/root.txt\n**/obj/**\n');
  assert.equal(ignored.ignored('bin/a.dll'), true);
  assert.equal(ignored.ignored('nested/a.tmp'), true);
  assert.equal(ignored.ignored('keep.tmp'), false);
  assert.equal(ignored.ignored('root.txt'), true);
  assert.equal(ignored.ignored('nested/root.txt'), false);
  assert.equal(ignored.ignored('a/obj/b.txt'), true);
  const root = new TestDirectoryHandle();
  await root.put('.gitignore', '*.tmp\n');
  await root.put('ignored.tmp', 'skip');
  await root.put('keep.cs', 'keep');
  const disk = await readDirectory(root, {applyGitignore: true});
  assert(!disk.record('ignored.tmp'));
  assert(disk.skipped.some(outcome => outcome.reason === 'gitignore'));
  assert.equal(new PathPolicy({caseSensitive: false}).equals('Program.CS', 'program.cs'), true);
});

test('A24 nested ignore rules support ranges, escaped literals and directory-only matches', async () => {
  const ignored = new GitIgnoreMatcher('cache/\n[ab]?.tmp\n\\#literal\n');
  assert.equal(ignored.ignored('a/cache', false), false);
  assert.equal(ignored.ignored('a/cache/file.cs', false), true);
  assert.equal(ignored.ignored('a1.tmp'), true);
  assert.equal(ignored.ignored('c1.tmp'), false);
  assert.equal(ignored.ignored('#literal'), true);
  const root = new TestDirectoryHandle();
  await root.put('.gitignore', '*.tmp\n');
  await root.put('src/.gitignore', '!keep.tmp\ncache/\n');
  await root.put('src/keep.tmp', 'kept');
  await root.put('src/rejected.tmp', 'skipped');
  await root.put('elsewhere/keep.tmp', 'skipped');
  await root.put('src/cache/item.cs', 'skipped');
  const disk = await readDirectory(root, {applyGitignore: true});
  assert(disk.record('src/keep.tmp'));
  assert(!disk.record('src/rejected.tmp'));
  assert(!disk.record('elsewhere/keep.tmp'));
  assert(!disk.record('src/cache/item.cs'));
  assert(disk.importReport.outcomes.some(outcome => outcome.path === 'src/cache' && outcome.reason === 'gitignore'));
});
