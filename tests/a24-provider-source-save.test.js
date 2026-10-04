import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/project-system';
import {hashFileBytes} from '@sharpforge/workspace';
import {studioDiskFixture} from './support/a24-studio-workspace-fixture.js';

test('provider saves encode captured immutable roots in each supported source encoding', async t => {
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
    const initial = encodeWorkspaceFile({path: 'A.cs', text: 'class A {}', encoding, bom: true});
    const fixture = await studioDiskFixture(t, {files: [['A.cs', initial]]});
    const model = fixture.documents.models.get('A.cs');
    model.applyEdits([{start: 0, end: 0, text: '// λ 😀\r\n'}]);
    const source = model.snapshot();
    const expected = '// λ 😀\r\nclass A {}';
    const result = await fixture.disk.save([{path: 'A.cs', source}]);
    const bytes = await fixture.provider.readFile('A.cs');
    const decoded = decodeWorkspaceFile('A.cs', bytes);
    assert.deepEqual(result.written, ['A.cs']);
    assert.equal(decoded.text, expected);
    assert.equal(decoded.encoding, encoding);
    assert.equal(decoded.bom, true);
    assert.equal(fixture.disk.baselineHashes.get('A.cs'), await hashFileBytes(bytes));
    assert.equal(source.statistics.textMaterialized, false);
    assert.equal(fixture.documents.require('A.cs').dirty, true, 'direct provider I/O does not claim document ownership');
  }
});

test('provider snapshot saves reject invalid source text before opening a write stream', async t => {
  const fixture = await studioDiskFixture(t);
  const original = await fixture.provider.readFile('A.cs');
  for (const text of ['\0class A {}', '\ufeffclass A {}', 'class A {}\ud800']) {
    const model = new EditorModel(text, {uri: 'A.cs', version: 2});
    const source = model.snapshot();
    await assert.rejects(fixture.disk.save([{path: 'A.cs', source}]),
      error => error.code === 'SFPROJECT_SOURCE_ENCODING_LOSS');
    assert.deepEqual(await fixture.provider.readFile('A.cs'), original);
    assert.equal(source.statistics.textMaterialized, false);
    model.dispose();
  }
  assert.deepEqual(fixture.writes, []);
});
