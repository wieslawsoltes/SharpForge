import test from 'node:test';
import assert from 'node:assert/strict';
import {scanDirectory, WorkspaceImportReport} from '@sharpforge/project-system';
import {FileSystemAccessProvider} from '@sharpforge/workspace';
import {TestDirectoryHandle} from './support/a24-fsa.js';

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
