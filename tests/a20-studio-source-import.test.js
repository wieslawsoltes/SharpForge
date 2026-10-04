import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStudioSourceFiles, prepareLegacyStudioProject } from '../apps/studio/workbench/source-imports.js';

test('a complete 501-file loose-source import stages without mutating existing sources', async t => {
  const before = [{ uri: 'Existing.cs', text: '// unsaved existing' }];
  const files = Array.from({ length: 501 }, (_, index) => new File(['// imported'], `File${index}.cs`));
  const prepared = await prepareStudioSourceFiles(files, before);
  t.after(() => { for (const record of prepared.records) record.model?.dispose(); });
  assert.equal(prepared.records.length, 502);
  assert.equal(prepared.records[0].text, '// unsaved existing');
  assert.equal(prepared.opened.length, 501);
  assert.deepEqual(before, [{ uri: 'Existing.cs', text: '// unsaved existing' }]);
});

test('failed later source reads leave every existing input untouched and enforce encoding/path policy', async () => {
  const before = [{ uri: 'Existing.cs', text: '// original' }];
  const files = [new File(['// replacement'], 'Existing.cs'), new File([''], 'Late.cs')];
  await assert.rejects(prepareStudioSourceFiles(files, before, {
    readFiles: async () => { throw new Error('late disk read failed'); }
  }), /late disk read failed/);
  assert.equal(before[0].text, '// original');
  await assert.rejects(prepareStudioSourceFiles([new File(['x'], 'Wrong.txt')]), /\.cs/);
  await assert.rejects(prepareStudioSourceFiles([new File(['x'], 'Same.cs'), new File(['x'], 'same.cs')]), /colliding/);
});

test('legacy JSON project conversion retains settings and rejects invalid metadata before loading', () => {
  const project = { format: 'sharpforge-project', version: 1, name: 'Converted', files: [{ uri: 'Program.cs', text: '// source' }],
    extraFiles: [{ path: '.editorconfig', text: '[*.cs]\nindent_size=2', encoding: 'utf-8', bom: false }],
    launchProfiles: { version: 1 }, startupConfiguration: { mode: 'single' } };
  const prepared = prepareLegacyStudioProject(project);
  assert.equal(prepared.records[1].path, '.editorconfig');
  assert.equal(prepared.options.settings.launchProfiles, project.launchProfiles);
  assert.equal(prepared.options.settings.startupConfiguration, project.startupConfiguration);
  assert.equal(prepared.options.settings.active, 'Program.cs');
  assert.throws(() => prepareLegacyStudioProject({ ...project, files: [...project.files, { uri: 'program.cs', text: '' }] }), /Duplicate/);
  assert.throws(() => prepareLegacyStudioProject({ ...project, files: [{ uri: '../Escape.cs', text: '' }] }));
  assert.throws(() => prepareLegacyStudioProject({ ...project, extraFiles: [{ path: 'Binary.bin', text: {} }] }), /workspace text/);
});
