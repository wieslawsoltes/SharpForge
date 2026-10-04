import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderDiskWorkspace, DISK_WORKSPACE_LIMITS } from '@sharpforge/project-system';
import { encodeWorkspaceFile } from '@sharpforge/archive';
import { commitWizardDirectory } from '../apps/studio/project-wizard/destination.js';
import { TestDirectory } from './helpers/a24-directory.js';

test('The wizard attaches provider records and subsequent saves preserve encoding and binary bytes', async () => {
  const root = new TestDirectory();
  const source = { path: 'Program.cs', text: 'class Original {}\r\n', encoding: 'utf-16be', bom: true };
  const binary = Uint8Array.of(0, 255, 128, 13, 10);
  const result = await commitWizardDirectory(root, {
    records: [{ path: source.path, bytes: encodeWorkspaceFile(source) }, { path: 'payload.bin', bytes: binary }], folders: ['Empty']
  });
  assert.equal(result.cancelled, false);
  assert.equal(result.directoryHandle, root);
  assert(result.disk instanceof ProviderDiskWorkspace);
  assert.equal(result.disk.rootHandle, root);
  assert.deepEqual(result.disk.folders, ['Empty']);
  assert.deepEqual(result.disk.record('payload.bin').bytes, binary);
  assert.equal(typeof result.disk.baselineHashes.get('payload.bin'), 'string');
  assert.equal(result.disk.record(source.path).encoding, source.encoding);
  assert.equal(result.disk.record(source.path).text, source.text);

  const changed = 'class Updated {}\r\n';
  const added = Uint8Array.of(4, 3, 2, 1);
  const saved = await result.disk.save([{ path: source.path, text: changed }, { path: 'new.bin', bytes: added, expectedHash: null }]);
  assert.deepEqual(saved.written, [source.path, 'new.bin']);
  assert.deepEqual((await root.getFileHandle(source.path)).bytes, encodeWorkspaceFile({ ...source, text: changed }));
  assert.deepEqual((await root.getFileHandle('payload.bin')).bytes, binary);
  assert.deepEqual((await root.getFileHandle('new.bin')).bytes, added);
});

test('The wizard keeps completed-write receipts when provider attachment fails', async () => {
  const root = new TestDirectory();
  root.entries = async function* () {
    if (this.state.writes > 0) throw new Error('Post-creation scan failed');
    yield* this.children;
  };
  await assert.rejects(() => commitWizardDirectory(root, { records: [{ path: 'Created.cs', text: 'class Created {}' }] }), error => {
    assert.match(error.message, /Post-creation scan failed/);
    assert.deepEqual(error.writeResult.written, ['Created.cs']);
    assert.equal(error.writeResult.atomic, false);
    return true;
  });
  assert.equal(new TextDecoder().decode((await root.getFileHandle('Created.cs')).bytes), 'class Created {}');
});

test('An already cancelled wizard attachment performs no directory or file writes', async () => {
  const root = new TestDirectory();
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(() => commitWizardDirectory(root, {
    records: [{ path: 'Nested/Created.cs', text: 'class Created {}' }]
  }, { signal: cancellation.signal }), { name: 'AbortError' });
  assert.equal(root.children.size, 0);
  assert.equal(root.state.writes, 0);
});

test('Generated source is immediately available when a large existing destination stays lazy', async () => {
  const root = new TestDirectory();
  const existing = await root.getDirectoryHandle('Existing', { create: true });
  for (let index = 0; index <= DISK_WORKSPACE_LIMITS.eagerThreshold; index++) {
    await existing.getFileHandle('Archive' + index + '.txt', { create: true });
  }
  const text = 'class Created { static void Main() {} }';
  const result = await commitWizardDirectory(root, { records: [{ path: 'Created/Program.cs', text }] });
  assert.equal(result.disk.lazy, true);
  assert.equal(result.disk.record('Created/Program.cs').lazy, false);
  assert.equal(result.disk.record('Created/Program.cs').text, text);
  assert.equal(typeof result.disk.baselineHashes.get('Created/Program.cs'), 'string');
  assert.equal(result.disk.record('Existing/Archive0.txt').lazy, true);
  assert.equal(result.disk.record('Existing/Archive0.txt').text, undefined);
});
