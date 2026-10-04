import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProjectPlan, createCompilationHandler} from '../apps/studio/workers/compilation-handler.js';
import {Workspace} from '@sharpforge/workspace';
import {loadProjectAssembly} from '@sharpforge/cil';
import {VirtualMachine} from '@sharpforge/runtime';

const unit = {project: 'Lib.csproj', contextId: 'lib', assemblyName: 'Library', output: 'Library.dll', options: {outputKind: 'library'},
  sources: [{uri: 'Lib.cs', text: 'public class Library { public static int Answer() { return 42; } }', version: 1}], references: []};

test('a later worker build accepts a real previous artifact and resolves its separately emitted dependency', () => {
  const library = compileProjectPlan({startup: unit.project, startupContextId: unit.contextId, units: [unit]});
  assert.equal(library.success, true, JSON.stringify(library.diagnostics));
  const consumer = {project: 'App.csproj', contextId: 'app', assemblyName: 'App', output: 'App.dll', options: {outputKind: 'exe'},
    sources: [{uri: 'App.cs', text: 'System.Console.WriteLine(Library.Answer());', version: 1}],
    references: [{project: unit.project, contextId: unit.contextId, output: unit.output}]};
  const plan = {startup: consumer.project, startupContextId: consumer.contextId, units: [consumer],
    dependencyArtifacts: library.projectArtifacts.map(artifact => ({...artifact, runtimeProfile: 'sharpforge'}))};
  const result = createCompilationHandler(new Workspace())({buildPlan: plan}, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === 'CS0518'), false, JSON.stringify(result.diagnostics));
  assert.equal(result.projectArtifacts.length, 1, 'previous artifacts are not recompiled or returned as new outputs');
  const graph = loadProjectAssembly(result.assembly, {dependencies: library.projectArtifacts});
  assert.equal(new VirtualMachine(graph.image).run().output, '42\n');
});

test('seeded contexts obey reference-output metadata and reject duplicate, missing, failed or unprofiled artifacts', () => {
  const artifact = {project: 'Lib.csproj', contextId: 'lib', success: true, assembly: Uint8Array.of(77, 90), runtimeProfile: 'sharpforge'};
  const consumer = {...unit, project: 'App.csproj', contextId: 'app', references: [
    {project: 'Lib.csproj', contextId: 'lib', output: 'Library.dll', referenceOutputAssembly: false}]};
  const plan = {startup: 'App.csproj', startupContextId: 'app', units: [consumer], dependencyArtifacts: [artifact]};
  const result = compileProjectPlan(plan, {compileUnit(_unit, options) {
    assert.deepEqual(options.references, []);
    return {success: true, diagnostics: [], assembly: Uint8Array.of(77, 90), image: {}, metrics: {errors: 0}};
  }});
  assert.equal(result.success, true);
  assert.throws(() => compileProjectPlan({...plan, dependencyArtifacts: []}), /dependency order/);
  assert.throws(() => compileProjectPlan({...plan, dependencyArtifacts: [artifact, artifact]}), /unique context/);
  for (const change of [{success: false}, {assembly: null}, {assembly: new Uint8Array()}, {runtimeProfile: undefined}]) {
    assert.throws(() => compileProjectPlan({...plan, dependencyArtifacts: [{...artifact, ...change}]}), /successful emitted assembly bytes/);
  }
  assert.throws(() => compileProjectPlan({...plan, units: [{...consumer, contextId: 'lib'}]}), /Duplicate/);
  assert.throws(() => compileProjectPlan({...plan, startupContextId: 'lib'}), /Startup project/);
});

test('seed artifact count and byte budgets are explicit before compilation begins', () => {
  const artifact = {project: 'Lib.csproj', success: true, assembly: Uint8Array.of(77, 90), runtimeProfile: 'sharpforge'};
  const plan = {startup: unit.project, startupContextId: unit.contextId, units: [unit]};
  assert.throws(() => compileProjectPlan({...plan,
    dependencyArtifacts: Array.from({length: 513}, (_, index) => ({...artifact, contextId: String(index)}))}), /count limit/);
  assert.throws(() => compileProjectPlan({...plan,
    dependencyArtifacts: Array.from({length: 512}, (_, index) => ({...artifact, contextId: String(index)}))}), /512 compilation contexts/);
  const bytes = new Uint8Array(64 * 1024 * 1024);
  assert.throws(() => compileProjectPlan({...plan,
    dependencyArtifacts: ['one', 'two', 'three'].map(contextId => ({...artifact, contextId, assembly: bytes}))}), /byte budget/);
});
