import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {readPE} from '@sharpforge/cil';
import {createCompilationHandler} from '../apps/studio/workers/compilation-handler.js';
import {createAssemblyArtifactCache} from '../apps/studio/workers/assembly-artifact-cache.js';

test('worker emission reuses equivalent newly derived metadata and invalidates after a source access change', () => {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  workspace.update('Library.cs', 'public class Library { public static int Answer() { return 42; } }', 1);
  const handler = createCompilationHandler(workspace);
  const first = handler({assemblyName: 'Library'}, 'build');
  assert.equal(first.success, true, JSON.stringify(first.diagnostics));
  assert.equal(first.metrics.assemblyCached, false);
  const second = handler({assemblyName: 'Library'}, 'build');
  assert.equal(second.metrics.assemblyCached, true);
  assert.equal(second.metrics.emitIlMs, 0);
  assert.deepEqual(second.assembly, first.assembly);
  const visibility = bytes => {
    const metadata = readPE(bytes).metadata;
    return metadata.rows[2].find(row => metadata.string(row[1]) === 'Library')[0] & 7;
  };
  assert.equal(visibility(first.assembly), 1);
  workspace.update('Library.cs', 'internal class Library { public static int Answer() { return 42; } }', 2);
  const changed = handler({assemblyName: 'Library'}, 'build');
  assert.equal(changed.success, true, JSON.stringify(changed.diagnostics));
  assert.equal(changed.metrics.assemblyCached, false);
  assert.equal(visibility(changed.assembly), 0);
  assert.notDeepEqual(changed.assembly, first.assembly);
  assert.equal(handler({assemblyName: 'RenamedLibrary'}, 'build').metrics.assemblyCached, false);
});

test('assembly cache distinguishes image, name, options, metadata and reference bytes without byte serialization', () => {
  const cache = createAssemblyArtifactCache();
  const image = {};
  const value = {assembly: Uint8Array.of(1)};
  const options = () => ({typeDefinitions: {Library: {access: 'public'}}, memberDefinitions: {version: 1, methods: [{id: 0, access: 'public'}]},
    assemblyAttributes: [{type: 'AssemblyVersion', value: '1.0.0.0'}], resources: [{name: 'Data', bytes: Uint8Array.of(1, 2)}],
    references: [{aliases: ['global'], bytes: Uint8Array.of(77, 90)}], peOptions: {subsystem: 3}});
  const original = options();
  assert.equal(cache.set(image, 'Library', original, value), true);
  assert.equal(cache.get(image, 'Library', options()), value);
  assert.equal(cache.get({}, 'Library', original), undefined);
  assert.equal(cache.get(image, 'Other', original), undefined);
  const changes = [
    next => { next.typeDefinitions.Library.access = 'internal'; },
    next => { next.memberDefinitions.methods[0].access = 'private'; },
    next => { next.assemblyAttributes[0].value = '2.0.0.0'; },
    next => { next.resources[0].bytes[0] = 3; },
    next => { next.references[0].bytes[1] = 91; },
    next => { next.references[0].aliases[0] = 'custom'; },
    next => { next.peOptions.subsystem = 2; },
    next => { next.includeDebug = false; },
  ];
  for (const change of changes) {
    const next = options();
    change(next);
    assert.equal(cache.get(image, 'Library', next), undefined);
  }
  original.resources[0].bytes[0] = 9;
  assert.equal(cache.get(image, 'Library', original), undefined, 'the retained snapshot does not alias mutable option bytes');
  assert.equal(cache.get(image, 'Library', options()), value);
});

test('cache budgets, unsupported option objects and per-image names bound optional reuse', () => {
  const image = {};
  const value = {};
  const cache = createAssemblyArtifactCache({maxNames: 2, maxBytes: 1024, maxValues: 20});
  assert.equal(cache.set(image, 'Large', {bytes: new Uint8Array(1024)}, value), false);
  assert.equal(cache.get(image, 'Large', {bytes: new Uint8Array(1024)}), undefined);
  assert.equal(cache.set(image, 'Many', {values: Array(20).fill(0)}, value), false);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(cache.set(image, 'Cyclic', cyclic, value), false);
  assert.equal(cache.set(image, 'Function', {hook() {}}, value), false);
  assert.equal(cache.set(image, 'Getter', {get option() { assert.fail('Cache inspection must not invoke an option getter'); }}, value), false);
  assert.equal(cache.set(image, 'Map', {options: new Map()}, value), false);
  for (const name of ['First', 'Second', 'Third']) assert.equal(cache.set(image, name, {}, value), true);
  assert.equal(cache.get(image, 'First', {}), undefined);
  assert.equal(cache.get(image, 'Second', {}), value);
  assert.equal(cache.get(image, 'Third', {}), value);
  assert.throws(() => createAssemblyArtifactCache({maxBytes: 0}), /positive safe integers/);
});
