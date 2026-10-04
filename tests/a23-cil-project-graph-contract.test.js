import test from 'node:test';
import assert from 'node:assert/strict';
import {Op, projectReferenceLimits, verifyImage} from '@sharpforge/bytecode';
import {emitAssembly, loadAssembly, loadProjectAssembly, readManagedResources} from '@sharpforge/cil';
import {referenceFixture, consumer} from './support/cil-project-profile-fixture.js';

const externalOperations = new Set([
  Op.EXTCALL, Op.EXTNEWOBJ, Op.EXTLDFLD, Op.EXTSTFLD, Op.EXTLDSTATIC, Op.EXTSTSTATIC,
]);

test('public project graph resolves real PE tokens and retains independent modules and source provenance', () => {
  const fixture = referenceFixture();
  const resource = {manifestName: 'MetadataConsumer.Payload', bytes: Uint8Array.of(0, 42, 255)};
  const attribute = {type: 'System.Reflection.AssemblyCompanyAttribute', value: 'Graph fixture'};
  const application = emitAssembly(consumer(fixture), {resources: [resource], assemblyAttributes: [attribute]});
  const suppliedLibrary = new Uint8Array(fixture.assembly);
  const graph = loadProjectAssembly({assembly: application, project: 'App.csproj', contextId: 'app/net10.0'}, {
    dependencies: [{assembly: suppliedLibrary, project: 'Library.csproj', contextId: 'library/net10.0'}, suppliedLibrary],
  });
  assert.deepEqual(graph.modules.map(module => module.identity.name), ['MetadataLibrary', 'MetadataConsumer']);
  const [library, entry] = graph.modules;
  assert.equal(graph.entryKey, entry.key);
  assert.deepEqual(entry.dependencies, [library.key]);
  assert.equal(entry.resources[0].name, resource.manifestName);
  assert.equal(entry.resources[0].size, resource.bytes.length);
  assert.deepEqual(readManagedResources(entry.inspector.pe, {includeBytes: true})[0].bytes, resource.bytes);
  assert.deepEqual(graph.image.assemblies.find(assembly => assembly.key === entry.key).assemblyAttributes, [attribute]);
  assert.deepEqual(library.identity.version, [1, 2, 3, 4]);
  assert.deepEqual(entry.image.externalReferences, fixture.profile);
  assert.equal(graph.image.externalReferences, undefined);
  assert.deepEqual(verifyImage(graph.image), []);
  for (const method of graph.image.methods) {
    for (let offset = 0; offset < method.code.length; offset += 3) {
      assert(!externalOperations.has(method.code[offset]), 'All external operations resolve before execution');
    }
  }
  for (const kind of ['types', 'methods', 'fields']) {
    assert.deepEqual(entry.references[kind].map(reference => reference.targetToken), fixture.profile[kind].map(item => item.token));
    for (const reference of entry.references[kind]) {
      assert.equal(reference.targetKey, library.key);
      assert.equal(reference.token >>> 24, kind === 'types' ? 1 : 10);
    }
  }
  const counter = graph.image.types.find(type => type.metadataName === 'Counter');
  assert.equal(counter.assemblyKey, library.key);
  assert.equal(counter.name, fixture.profile.types[0].imageName);
  assert(library.image.sources.length > 0);
  for (const source of library.image.sources) {
    const linked = graph.image.sources.find(record => record.assemblyKey === library.key
      && record.uri === library.sourceUris.get(source.uri));
    assert.equal(linked.project, 'Library.csproj');
    assert.equal(linked.contextId, 'library/net10.0');
  }
  assert.equal(graph.image.il.methodTokens.length, graph.image.methods.length);
  assert.equal(graph.image.il.offsets.length, graph.image.methods.length);
  assert.equal(graph.image.il.methodAssemblyKeys.length, graph.image.methods.length);
  for (const method of graph.image.methods) {
    assert.equal(graph.image.il.methodAssemblyKeys[method.id], method.assemblyKey);
    if (method.synthetic) {
      assert.equal(graph.image.il.methodTokens[method.id], null);
      assert.deepEqual(graph.image.il.offsets[method.id], []);
    } else assert.equal(graph.image.il.methodTokens[method.id] >>> 24, 6);
  }
  const originalByte = suppliedLibrary[0];
  suppliedLibrary[0] ^= 255;
  assert.equal(library.bytes[0], originalByte, 'Admission snapshots caller-owned bytes');
  assert.deepEqual(loadAssembly(application).externalReferences, fixture.profile);
});

test('public project graph rejects missing content, forged hashes and incorrect target method definitions', () => {
  const fixture = referenceFixture();
  const application = emitAssembly(consumer(fixture));
  assert.throws(() => loadProjectAssembly(application), {code: 'PRJ0002'});
  const wrongHash = consumer(referenceFixture());
  wrongHash.externalReferences.assemblies[0].sha256 = '0'.repeat(64);
  assert.throws(() => loadProjectAssembly(emitAssembly(wrongHash), {dependencies: [fixture.assembly]}), {code: 'PRJ0003'});
  const wrongMethod = consumer(referenceFixture());
  wrongMethod.externalReferences.methods[1].token = 0x0600ffff;
  assert.throws(() => loadProjectAssembly(emitAssembly(wrongMethod), {dependencies: [fixture.assembly]}), {code: 'PRJ0005'});
});

test('public project graph accepts a library entry and bounded identical inputs, and observes cancellation', () => {
  const fixture = referenceFixture();
  const dependencies = Array(projectReferenceLimits.assemblies).fill(fixture.assembly);
  const graph = loadProjectAssembly(fixture.assembly, {dependencies});
  assert.equal(graph.modules.length, 1);
  assert.equal(graph.image.outputKind, 'library');
  assert.equal(graph.image.entryPoint, null);
  assert.throws(() => loadProjectAssembly(fixture.assembly, {dependencies: [...dependencies, fixture.assembly]}), {code: 'PRJ0006'});
  assert.throws(() => loadProjectAssembly(new Uint8Array()), {code: 'PRJ0006'});
  assert.throws(() => loadProjectAssembly('not PE bytes'), {code: 'PRJ0001'});
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => loadProjectAssembly(fixture.assembly, {signal: controller.signal}), {code: 'PRJ0007'});
});
