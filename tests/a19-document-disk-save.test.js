import test from 'node:test';
import assert from 'node:assert/strict';
import { readDirectory } from '@sharpforge/project-system';
import { encodeWorkspaceFile, decodeWorkspaceFile } from '@sharpforge/archive';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { readStudioSource } from '../apps/studio/workbench/studio-source-reader.js';
import { sourceFileHandle, sourceDirectory } from './fixtures/a20-source-file-fixture.js';

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`captured DocumentService→DiskWorkspace ${encoding} saves stream the written source while newer model edits remain dirty`, async () => {
    const text = 'x'.repeat(65_535) + '😀\r\nend';
    const handle = sourceFileHandle('Program.cs', encodeWorkspaceFile({ path: 'Program.cs', text, encoding, bom: true }));
    const disk = await readDirectory(sourceDirectory({ 'Program.cs': handle }), { readSource: readStudioSource });
    let captured;
    const documents = new DocumentService({ records: disk.records, saveDocument: async snapshot => {
      captured = snapshot;
      const report = await disk.save([{ uri: snapshot.uri, source: snapshot.source, version: snapshot.version }]);
      return report.written.includes(snapshot.uri);
    } });
    const model = documents.models.get('Program.cs');
    const initial = model.snapshot();
    model.applyEdits([{ start: model.length, end: model.length, text: ' saved' }]);
    const saving = documents.save('Program.cs');
    const written = captured.source;
    model.applyEdits([{ start: model.length, end: model.length, text: ' later' }]);
    assert.equal(await saving, false);
    assert.equal(documents.get('Program.cs').dirty, true);
    assert.equal(documents.baselines.get('Program.cs'), written);
    assert.equal(disk.baseline.get('Program.cs'), written);
    assert.equal(decodeWorkspaceFile('Program.cs', handle.bytes).text, text + ' saved');
    assert.equal(decodeWorkspaceFile('Program.cs', handle.bytes).encoding, encoding);
    assert.equal(handle.metrics.written, 1);
    assert(handle.metrics.chunks >= 2);
    assert.equal(initial.statistics.textMaterialized, false);
    assert.equal(written.statistics.textMaterialized, false);
    assert.equal(model.snapshot().statistics.textMaterialized, false);
    assert.equal(await documents.save('Program.cs'), true);
    assert.equal(documents.baselines.get('Program.cs'), model.snapshot());
    assert.equal(disk.baseline.get('Program.cs'), model.snapshot());
    assert.equal(model.snapshot().statistics.textMaterialized, false);
    assert.equal(decodeWorkspaceFile('Program.cs', handle.bytes).text, text + ' saved later');
    documents.dispose();
  });
}

test('a failed streamed disk write preserves DocumentService and DiskWorkspace baselines and owned model state', async () => {
  const handle = sourceFileHandle('Program.cs', 'original', { failWrite: true });
  const disk = await readDirectory(sourceDirectory({ 'Program.cs': handle }), { readSource: readStudioSource });
  const documents = new DocumentService({ records: disk.records, saveDocument: snapshot =>
    disk.save([{ uri: snapshot.uri, source: snapshot.source, version: snapshot.version }]) });
  const model = documents.models.get('Program.cs');
  const initial = model.snapshot();
  model.applyEdits([{ start: 0, end: 0, text: 'edited' }]);
  await assert.rejects(documents.save('Program.cs'), /write unavailable/);
  assert.equal(documents.baselines.get('Program.cs'), initial);
  assert.equal(disk.baseline.get('Program.cs'), initial);
  assert.equal(documents.get('Program.cs').dirty, true);
  assert.equal(documents.ownsModel(model), true);
  assert.equal(handle.metrics.aborted, 1);
  assert.equal(handle.metrics.written, 0);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  documents.dispose();
});
