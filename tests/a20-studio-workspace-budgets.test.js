import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWorkspaceFile } from '@sharpforge/project-system';
import { readStudioFiles } from '../apps/studio/workbench/source-imports.js';
import { validateStudioWorkspaceRecords, studioDiskLimits } from '../apps/studio/workbench/workspace-limits.js';
import { loadStudioWorkspace } from '../apps/studio/workbench/studio-workspace-loader.js';
import { canRecoverStudioWorkspace, storeStudioRecovery } from '../apps/studio/workbench/studio-recovery-store.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';

test('whole workspace limits count actual UTF-16 encoded bytes across imported files', async t => {
  const text = 'x'.repeat(15);
  const files = ['One.cs', 'Two.cs'].map(path => new File([
    encodeWorkspaceFile({ path, text, encoding: 'utf-16le', bom: true })
  ], path));
  const records = await readStudioFiles(files);
  t.after(() => records.forEach(record => record.model.dispose()));
  assert.equal(records.reduce((sum, record) => sum + record.length, 0), 30);
  await assert.rejects(validateStudioWorkspaceRecords(records, {
    limits: { ...studioDiskLimits, maxFileBytes: 40, maxTotalBytes: 60 }
  }), /total encoded byte limit/);
});

test('workspace budgets include binary file count and aggregate bytes', async () => {
  const records = [{ path: 'One.cs', text: 'hello' }, { path: 'Asset.bin', bytes: new Uint8Array(60) }];
  await assert.rejects(validateStudioWorkspaceRecords(records, {
    limits: { ...studioDiskLimits, maxFiles: 1 }
  }), /files in one workspace/);
  await assert.rejects(validateStudioWorkspaceRecords(records, {
    limits: { ...studioDiskLimits, maxTotalBytes: 64 }
  }), /total encoded byte limit/);
});

test('edited source roots are counted again instead of trusting original encoded metadata', async t => {
  const records = await readStudioFiles([new File(['one'], 'One.cs')]);
  const record = records[0];
  t.after(() => record.model.dispose());
  record.model.applyEdits([{ start: 0, end: 3, text: 'é'.repeat(20) }]);
  record.source = record.model.snapshot();
  assert.equal(record.byteLength, 3);
  await assert.rejects(validateStudioWorkspaceRecords(records, {
    limits: { ...studioDiskLimits, maxFileBytes: 32 }
  }), /byte limit/);
});

test('empty binary recovery succeeds and recovery preflight errors are reported without escaping', t => {
  const { services } = studioLoaderFixture(t);
  assert.equal(canRecoverStudioWorkspace(services.documents, [{ path: 'Empty.bin', bytes: new Uint8Array() }]), true);
  const errors = [];
  assert.equal(storeStudioRecovery({ documents: services.documents, extraFiles: [{ path: 'Missing.bin' }],
    storage: { setItem() { throw new Error('must not reach serialization'); } }, key: 'workspace', capture: () => ({}),
    onError: error => errors.push(error) }), false);
  assert.equal(errors.length, 1);
});

test('a saved project-file selection cannot become a source document active URI', async t => {
  const { context, services, state } = studioLoaderFixture(t);
  await loadStudioWorkspace([
    { path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>' },
    { path: 'Program.cs', text: 'System.Console.WriteLine("ok");' }
  ], { entry: 'App.csproj', settings: { active: 'App.csproj', tabs: ['App.csproj', 'Program.cs'] } }, context);
  assert.equal(state.active, 'Program.cs');
  assert.deepEqual(services.documents.tabs, ['Program.cs']);
});
