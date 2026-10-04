import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReferenceLimits} from '@sharpforge/bytecode';
import {projectRuntimeDependencies} from '../apps/studio/project-runtime-input.js';

test('A23 project launch transmits explicit dependency bytes without duplicating the entry or analysis results', () => {
  const assembly = Uint8Array.of(1, 2);
  const library = Uint8Array.of(3, 4);
  const result = {success: true, assembly, projectArtifacts: [
    {success: true, assembly: library, project: 'Library.csproj', contextId: 'library/net10',
      pdb: Uint8Array.of(5), resources: [{bytes: Uint8Array.of(6)}], metrics: {files: 99}},
    {success: true, assembly, project: 'App.csproj', contextId: 'app/net10'},
  ]};
  const dependencies = projectRuntimeDependencies(result);
  assert.deepEqual(dependencies, [{assembly: library, project: 'Library.csproj', contextId: 'library/net10'}]);
  assert.equal(dependencies[0].assembly, library, 'worker transport owns the later structured clone');
  assert.deepEqual(projectRuntimeDependencies({success: true, assembly}), []);
  assert.equal(result.projectArtifacts.length, 2);
});

test('A23 project launch rejects incomplete and oversized artifact envelopes before worker transport', () => {
  for (const result of [null, {success: false}, {success: true, projectArtifacts: {}},
    {success: true, projectArtifacts: [null]}, {success: true, projectArtifacts: [{success: false}]},
    {success: true, projectArtifacts: [{success: true, assembly: []}]},
    {success: true, projectArtifacts: [{success: true, assembly: new Uint8Array()}]}]) {
    assert.throws(() => projectRuntimeDependencies(result));
  }
  assert.throws(() => projectRuntimeDependencies({success: true,
    projectArtifacts: new Array(projectReferenceLimits.assemblies + 1)}), /artifact-count/);
  const tooLarge = new Uint8Array(projectReferenceLimits.assemblyBytes + 1);
  assert.throws(() => projectRuntimeDependencies({success: true,
    projectArtifacts: [{success: true, assembly: tooLarge}]}), /assembly byte/);
  const part = new Uint8Array(projectReferenceLimits.assemblyBytes);
  assert.throws(() => projectRuntimeDependencies({success: true, assembly: Uint8Array.of(1),
    projectArtifacts: [{success: true, assembly: part}, {success: true, assembly: part}]}), /aggregate byte/);
});

test('A23 project launch bounds the entry assembly even without dependencies or when its artifact is duplicated', () => {
  for (const assembly of [undefined, [], new Uint16Array(1), new Uint8Array()]) {
    assert.throws(() => projectRuntimeDependencies({success: true, assembly}), /emitted PE bytes/);
  }
  const assembly = new Uint8Array(projectReferenceLimits.assemblyBytes + 1);
  assert.throws(() => projectRuntimeDependencies({success: true, assembly}), /assembly byte/);
  assert.throws(() => projectRuntimeDependencies({success: true, assembly,
    projectArtifacts: [{success: true, assembly}]}), /assembly byte/);
});
