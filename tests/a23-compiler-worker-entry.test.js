import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {loadProjectAssembly} from '@sharpforge/cil';
import {VirtualMachine} from '@sharpforge/runtime';
import {WorkerClient} from '../apps/studio/workbench/worker-client.js';

function compilerWorker(context) {
  let closed;
  const client = new WorkerClient(new URL('./support/compiler-project-worker.mjs', import.meta.url), {
    kind: 'compiler', timeoutMs: 10000,
    workerFactory(url, options) {
      const worker = new Worker(url, options);
      const transport = {
        postMessage: value => worker.postMessage(value),
        terminate: () => closed ??= worker.terminate(),
      };
      worker.on('message', data => transport.onmessage?.({data}));
      worker.on('error', error => transport.onerror?.({message: error.message, error}));
      return transport;
    },
  });
  context.after(async () => { client.dispose(); await closed; });
  return client;
}

test('production compiler worker emits independent project artifacts through the registered build handler', async context => {
  const worker = compilerWorker(context);
  const library = {project: 'Library.csproj', contextId: 'library', assemblyName: 'Library', output: 'Library.dll',
    options: {outputKind: 'library'}, references: [],
    sources: [{uri: 'Library.cs', text: 'public class Library { public static int Answer() { return 42; } }', version: 1}]};
  const application = {project: 'App.csproj', contextId: 'app', assemblyName: 'App', output: 'App.dll',
    options: {outputKind: 'exe'}, references: [{project: library.project, contextId: library.contextId, output: library.output}],
    sources: [{uri: 'App.cs', text: 'System.Console.WriteLine(Library.Answer());', version: 1}]};
  const result = await worker.request('build', {revision: 7, buildPlan: {
    startup: application.project, startupContextId: application.contextId, units: [library, application],
  }});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.projectArtifacts.length, 2);
  assert.deepEqual(result.projectArtifacts.map(artifact => artifact.contextId), ['library', 'app']);
  for (const artifact of result.projectArtifacts) {
    assert.equal(artifact.success, true);
    assert.ok(artifact.assembly instanceof Uint8Array);
    assert.deepEqual([...artifact.assembly.subarray(0, 2)], [77, 90]);
  }
  const dependencies = result.projectArtifacts.filter(artifact => artifact.project !== application.project);
  const graph = loadProjectAssembly(result.assembly, {dependencies});
  assert.equal(new VirtualMachine(graph.image).run().output, '42\n');
  assert.equal(worker.pending.size, 0);
});

test('production compiler worker preserves newer source versions, exact release and emission cache reuse', async context => {
  const worker = compilerWorker(context);
  const current = {uri: 'Current.cs', text: 'public class Modern { }', version: 2};
  const options = {compilationOptions: {outputKind: 'library'}, assemblyName: 'Current'};
  const first = await worker.request('build', {...options, files: [current]});
  assert.equal(first.success, true, JSON.stringify(first.diagnostics));
  const cached = await worker.request('build', options);
  assert.equal(cached.metrics.assemblyCached, true);
  assert.deepEqual(cached.assembly, first.assembly);
  assert.deepEqual(await worker.request('releaseDocuments', {documents: [{uri: current.uri, version: 1}]}), {released: []});
  const stale = await worker.request('analyze', {...options,
    files: [{...current, text: 'public class Obsolete { }', version: 1}]});
  assert.ok(stale.symbols.some(symbol => symbol.name === 'Modern'));
  assert.equal(stale.symbols.some(symbol => symbol.name === 'Obsolete'), false);
  await assert.rejects(worker.request('releaseDocuments', {documents: [{uri: current.uri, version: 0}]}),
    /positive safe version/);
  assert.deepEqual(await worker.request('releaseDocuments', {documents: [{uri: current.uri, version: 2}]}),
    {released: [current.uri]});
  const released = await worker.request('analyze', options);
  assert.equal(released.symbols.some(symbol => symbol.name === 'Modern'), false);
  assert.equal(worker.pending.size, 0);
});

test('production compiler worker exposes semantic type previews without mutating document content', async context => {
  const worker = compilerWorker(context);
  const files = [{uri: 'Hero.cs', text: 'public class Hero { }', version: 1},
    {uri: 'Use.cs', text: 'public class Use { public static Hero Create() { return new Hero(); } }', version: 1}];
  const preview = await worker.request('prepareTypeRename', {files, compilationOptions: {outputKind: 'library'},
    uri: 'Hero.cs', name: 'Hero', newName: 'Champion'});
  assert.equal(preview.available, true, JSON.stringify(preview));
  assert.deepEqual(new Set(preview.edits.map(edit => edit.uri)), new Set(['Hero.cs', 'Use.cs']));
  assert.ok(preview.edits.every(edit => edit.newText === 'Champion'));
  const symbols = await worker.request('symbols', {uri: 'Hero.cs'});
  assert.ok(symbols.some(symbol => symbol.name === 'Hero'));
  const invalid = await worker.request('prepareTypeRename', {uri: 'Hero.cs', name: 'Hero', newName: 'class'});
  assert.equal(invalid.available, false);
  assert.equal(invalid.diagnostic.code, 'SFL2402');
  assert.equal(worker.pending.size, 0);
});
