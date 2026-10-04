import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDirectory, WorkspaceImportReport, GitIgnoreMatcher} from '@sharpforge/project-system';
import {FileSystemAccessProvider} from '@sharpforge/workspace';
import {TestDirectoryHandle, TestFileHandle} from './support/a24-fsa.js';

test('A24 metadata scan admits 20000 files without reading their contents and rejects cancelled results', async () => {
  const root = new TestDirectoryHandle();
  for (let index = 0; index < 20000; index++) {
    const name = `Source${index}.cs`;
    root.children.set(name, new TestFileHandle(name, `class C${index} {}`));
  }
  const provider = new FileSystemAccessProvider(root);
  const scanned = await scanDirectory(provider);
  assert.equal(scanned.records.length, 20000);
  assert(scanned.records.every(record => record.lazy && record.text === undefined && record.bytes === undefined));
  assert.equal([...root.children.values()].reduce((count, handle) => count + handle.reads, 0), 0);
  const controller = new AbortController();
  await assert.rejects(scanDirectory(provider, {signal: controller.signal, onProgress() { controller.abort(); }}),
    error => error.name === 'AbortError');
  assert.equal(scanned.records.length, 20000);
  provider.dispose();
});

test('A24 rejected names and file-size limits are reported per path without losing usable entries', async () => {
  const root = new TestDirectoryHandle();
  await root.put('Program.cs', 'class Program {}');
  await root.put('con.txt', 'reserved');
  await root.put('large.bin', new Uint8Array(200));
  const provider = new FileSystemAccessProvider(root);
  const {records, report} = await scanDirectory(provider, {maxFileBytes: 100});
  assert.deepEqual(records.map(record => record.path), ['Program.cs']);
  assert(report.skipped.some(outcome => outcome.path === 'large.bin' && outcome.reason === 'file-too-large'));
  assert(report.skipped.some(outcome => outcome.path === 'con.txt' && outcome.reason === 'non-portable-path'));
  assert.equal(root.children.get('large.bin').reads, 0);
  provider.dispose();
});

test('A24 import policies distinguish Unicode aliases and honor scoped ignore rules', async () => {
  const report = new WorkspaceImportReport();
  assert.equal(report.admit('Program.CS'), 'Program.CS');
  assert.equal(report.admit('program.cs'), null);
  assert.equal(report.admit('é.cs'), 'é.cs');
  assert.equal(report.admit('e\u0301.cs'), null);
  assert.equal(report.skipped.length, 2);
  const ignored = new GitIgnoreMatcher('cache/\n[ab]?.tmp\n\\#literal\n');
  assert.equal(ignored.ignored('a/cache', false), false);
  assert.equal(ignored.ignored('a/cache/file.cs', false), true);
  assert.equal(ignored.ignored('a1.tmp'), true);
  assert.equal(ignored.ignored('c1.tmp'), false);
  assert.equal(ignored.ignored('#literal'), true);
  const root = new TestDirectoryHandle();
  await root.put('src/.gitignore', '!keep.tmp\ncache/\n');
  await root.put('src/keep.tmp', 'kept');
  await root.put('src/rejected.tmp', 'skipped');
  await root.put('elsewhere/keep.tmp', 'skipped');
  await root.put('src/cache/item.cs', 'skipped');
  const provider = new FileSystemAccessProvider(root);
  const {records, report: outcomes} = await scanDirectory(provider, {applyGitignore: true, gitignore: '*.tmp\n'});
  const paths = new Set(records.map(record => record.path));
  assert(paths.has('src/keep.tmp'));
  assert(!paths.has('src/rejected.tmp'));
  assert(!paths.has('elsewhere/keep.tmp'));
  assert(!paths.has('src/cache/item.cs'));
  assert(outcomes.skipped.some(outcome => outcome.path === 'src/cache' && outcome.reason === 'gitignore'));
  provider.dispose();
});

test('A24 file and report entry budgets remain explicit boundaries', async () => {
  const root = new TestDirectoryHandle();
  for (const name of ['a.cs', 'b.cs', 'c.cs']) await root.put(name, 'class C {}');
  const provider = new FileSystemAccessProvider(root);
  const result = await scanDirectory(provider, {maxFiles: 2});
  assert.equal(result.records.length, 2);
  assert.equal(result.report.skipped[0].reason, 'file-count-limit');
  const report = new WorkspaceImportReport({maxEntries: 1});
  report.skip('one', 'test');
  assert.throws(() => report.skip('two', 'test'), /entry limit/);
  provider.dispose();
});
