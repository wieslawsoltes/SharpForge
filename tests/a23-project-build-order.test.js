import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem} from '@sharpforge/project-system';
import {compileProjectPlan} from '../apps/studio/workers/compilation-handler.js';
import {requestProjectCompilation} from '../apps/studio/project-build.js';
import {projectBuildOrderFiles} from './support/project-build-order-fixture.js';

function stateOf({failure = ''} = {}) {
  const files = projectBuildOrderFiles({failure});
  const program = files.find(file => file.path === 'App/Program.cs');
  const projectSystem = new ProjectSystem(files.map(file => file === program ? {path: file.path, lazy: true, size: file.text.length} : file));
  const projectSnapshot = projectSystem.load('App/App.csproj');
  const state = {projectSystem, projectSnapshot, startupProject: 'App/App.csproj', files: [], revision: 1};
  const reads = [];
  state.disk = {load: async path => {
    reads.push(path);
    assert(projectSystem.files.has('Shared/Version.cs'), 'future consumer input hydration waits for dependency finalization');
    return {path, text: program.text};
  }};
  return {state, reads};
}

test('dependency after-build outputs feed consumer preparation before its separate worker compilation', async () => {
  const {state, reads} = stateOf();
  const calls = [];
  const result = await requestProjectCompilation(state, {request(method, request) {
    assert.equal(method, 'build');
    assert.equal(request.buildPlan.units.length, 1);
    const unit = request.buildPlan.units[0];
    calls.push(unit.project);
    if (unit.project === 'Lib/Lib.csproj') {
      assert.equal(state.projectSystem.files.has('Shared/Version.cs'), false);
      assert.equal(request.buildPlan.dependencyArtifacts.length, 0);
    } else {
      assert.equal(request.buildPlan.dependencyArtifacts.length, 1);
      assert.equal(request.buildPlan.dependencyArtifacts[0].project, 'Lib/Lib.csproj');
      assert.equal(request.buildPlan.dependencyArtifacts[0].runtimeProfile, 'sharpforge');
      assert(unit.sources.find(source => source.uri === 'App/Generated.cs').text.includes('return 42;'));
      assert.equal(unit.sources.some(source => source.uri === 'Lib/Code.cs'), false);
    }
    return compileProjectPlan(request.buildPlan);
  }}, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(calls, ['Lib/Lib.csproj', 'App/App.csproj']);
  assert.deepEqual(reads, ['App/Program.cs']);
  assert.deepEqual(result.projectArtifacts.map(artifact => artifact.project), calls);
  assert.deepEqual(result.targetResults.map(phase => phase.project + ':' + phase.phase), [
    'Lib/Lib.csproj:beforeCompile', 'Lib/Lib.csproj:afterCompile', 'App/App.csproj:beforeCompile', 'App/App.csproj:afterCompile',
  ]);
  assert.equal(result.metrics.projects, 2);
  assert(result.assembly instanceof Uint8Array);
});

test('failed dependency compilation or after targets prevent consumer preparation and lazy reads', async () => {
  for (const failure of ['compile', 'after']) {
    const {state, reads} = stateOf({failure});
    const calls = [];
    const result = await requestProjectCompilation(state, {request(_method, request) {
      calls.push(request.buildPlan.units[0].project);
      return compileProjectPlan(request.buildPlan);
    }}, 'build');
    assert.equal(result.success, false);
    assert.deepEqual(calls, ['Lib/Lib.csproj']);
    assert.deepEqual(reads, []);
    assert.equal(state.projectSystem.files.has('App/Generated.cs'), false);
    assert.equal(state.projectSystem.files.has('Shared/Version.cs'), false, 'failed after targets roll back their output');
    assert.equal(result.projectArtifacts.length, 2);
    assert(result.projectArtifacts.every(artifact => !artifact.success));
    assert(result.diagnostics.some(diagnostic => diagnostic.code === 'SFP1901' && diagnostic.project === 'App/App.csproj'));
  }
});

test('buildUnit materializes only one prepared context and refuses unloaded or unknown requested contexts', () => {
  const {state} = stateOf();
  const contexts = state.projectSystem.buildContexts(state.startupProject);
  const library = state.projectSystem.buildUnit(state.startupProject, contexts[0].contextId);
  assert.deepEqual(library.sources.map(source => source.uri), ['Lib/Code.cs']);
  assert.throws(() => state.projectSystem.buildUnit(state.startupProject, contexts[1].contextId), /missing/);
  assert.throws(() => state.projectSystem.buildUnit(state.startupProject, 'unknown'), /absent/);
  assert.throws(() => state.projectSystem.buildPlan(state.startupProject), /missing/);
});

test('cancellation while a dependency compiles runs no after hooks or consumer requests', async () => {
  const {state} = stateOf();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(requestProjectCompilation(state, {request(_method, request) {
    calls++;
    const result = compileProjectPlan(request.buildPlan);
    controller.abort();
    return result;
  }}, 'build', {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(calls, 1);
  assert.equal(state.projectSystem.files.has('Shared/Version.cs'), false);
});
