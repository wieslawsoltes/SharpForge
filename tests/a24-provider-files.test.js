import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderFiles, isProjectEvaluationInput} from '@sharpforge/project-system';

function file(name, values) {
  const bytes = Uint8Array.from(values);
  return {name, size: bytes.length, reads: 0, async arrayBuffer() { this.reads++; return bytes.slice().buffer; }};
}

test('provider file import retains exact unknown bytes and reports rejected paths without reading them', async () => {
  const binary = file('data.bin', [0, 255, 1]);
  const reserved = file('con.txt', [65]);
  const large = file('large.txt', new Uint8Array(20));
  const records = await readProviderFiles([binary, reserved, large], {maxFileBytes: 10});
  assert.deepEqual(records.map(record => record.path), ['data.bin']);
  assert.deepEqual(records[0].bytes, Uint8Array.of(0, 255, 1));
  assert.equal(records.importReport.outcomes.length, 2);
  assert.equal(reserved.reads + large.reads, 0);
});

test('provider file import rejects pre-aborted work and entry limits before content reads', async () => {
  const source = file('A.cs', [65]);
  await assert.rejects(readProviderFiles([source], {signal: AbortSignal.abort()}), {name: 'AbortError'});
  await assert.rejects(readProviderFiles([source], {maxFiles: 0}), /file limit/);
  assert.equal(source.reads, 0);
});

test('project evaluation inputs include auxiliary metadata while source files remain lazy', () => {
  for (const path of ['App.csproj', 'Directory.Build.props', 'Directory.Packages.props', 'Strings.resx',
    '.editorconfig', 'global.json', 'App/Properties/launchSettings.json', '.sharpforge/workspace.json']) {
    assert.equal(isProjectEvaluationInput(path), true, path);
  }
  assert.equal(isProjectEvaluationInput('Program.cs'), false);
  assert.equal(isProjectEvaluationInput('image.png'), false);
});
