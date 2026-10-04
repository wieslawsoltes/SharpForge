import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, emitAssembly, loadAssembly, loadProjectAssembly, readManagedResources} from '@sharpforge/cil';
import {Op, verifyImage, projectReferenceLimits, projectAssemblyKey} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {counterApplicationSource, counterLibrarySource, projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';

const dependency = result => ({assembly: result.assembly});
const instructions = image => image.methods.flatMap(method => Array.from(
  {length: method.code.length / 3}, (_, index) => method.code[index * 3],
));

test('closed project loading preserves distinct canonical PEs and resolves all six external operations', () => {
  const library = projectLibrary();
  const application = projectApplication(counterApplicationSource, [library]);
  const callerBytes = new Uint8Array(library.assembly);
  const unlinked = loadAssembly(application.assembly);
  assert.deepEqual(unlinked.externalReferences, application.image.externalReferences);
  assert.equal(new AssemblyInspector(application.assembly).types.some(type => type.name === 'Counter'), false);
  const graph = loadProjectAssembly(application.assembly, {dependencies: [{assembly: callerBytes,
    project: 'Library/Library.csproj', contextId: 'library-net10'}]});
  assert.deepEqual(graph.modules.map(module => module.identity.name), ['Library', 'App']);
  assert.deepEqual(verifyImage(graph.image), []);
  assert.equal(graph.image.externalReferences, undefined);
  assert(instructions(graph.image).every(operation => operation < Op.EXTCALL));
  const original = graph.modules.find(module => module.identity.name === 'App');
  assert.deepEqual(original.image.externalReferences, unlinked.externalReferences);
  for (const [index, method] of original.image.methods.entries()) assert.deepEqual(method.code, unlinked.methods[index].code);
  assert.equal(graph.modules[0].contextId, 'library-net10');
  assert.equal(graph.image.il.methodTokens.length, graph.image.methods.length);
  assert.equal(graph.image.il.offsets.length, graph.image.methods.length);
  for (const method of graph.image.methods) {
    assert.equal(graph.image.il.methodAssemblyKeys[method.id], method.assemblyKey);
    if (method.synthetic) assert.equal(graph.image.il.methodTokens[method.id], null);
  }
  const type = graph.image.types.find(type => type.metadataName === 'Counter');
  assert.equal(type.assemblyKey, graph.modules[0].key);
  assert.equal(type.name, '[' + type.assemblyKey + ']Counter');
  assert(original.references.methods.some(reference => reference.token >>> 24 === 10 && reference.targetToken >>> 24 === 6));
  assert(original.references.fields.some(reference => reference.token >>> 24 === 10 && reference.targetToken >>> 24 === 4));
  const documents = graph.image.sources;
  assert.equal(new Set(documents.map(source => source.uri)).size, documents.length);
  assert(documents.some(source => source.originalUri && source.uri.startsWith('sharpforge-assembly://')));
  for (const module of graph.modules) {
    for (const source of module.image.sources) {
      const linked = documents.find(document => document.assemblyKey === module.key && document.uri === module.sourceUris.get(source.uri));
      assert.equal(linked.text, source.text);
      assert.equal(linked.project, module.project);
      assert.equal(linked.contextId, module.contextId);
    }
  }
  assert(graph.image.sequencePoints.every(point => documents.some(source => source.uri === point.uri)));
  callerBytes.fill(0);
  assert.notEqual(graph.modules[0].bytes[0], 0, 'The verified module owns its byte snapshot');
  const result = new VirtualMachine(graph.image).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.output, '42\n42\n44\nnull\n');
});

test('transitive project closure resolves a library without inventing its entry point', () => {
  const library = projectLibrary('Library', 'public class A { public static int Answer() { return 40; } }');
  const middle = projectLibrary('Middle', 'public class B { public static int Answer() { return A.Answer() + 2; } }',
    {references: [{bytes: library.assembly, runtimeProfile: 'sharpforge'}]});
  const application = projectApplication('System.Console.WriteLine(B.Answer());', [middle]);
  assert.equal(middle.image.entryPoint, null);
  assert.throws(() => loadProjectAssembly(application.assembly, {dependencies: [dependency(middle)]}), {code: 'PRJ0002'});
  const graph = loadProjectAssembly(application.assembly, {dependencies: [dependency(middle), dependency(library)]});
  assert.deepEqual(graph.modules.map(module => module.identity.name), ['Library', 'Middle', 'App']);
  assert.equal(new VirtualMachine(graph.image).run().output, '42\n');
  const libraryGraph = loadProjectAssembly(middle.assembly, {dependencies: [dependency(library)]});
  assert.equal(libraryGraph.image.outputKind, 'library');
  assert.equal(libraryGraph.image.entryPoint, null);
});

test('same-named aliased dependency types retain separate objects, statics and opaque assembly names', () => {
  const source = 'public class Counter { public static int Total; public int Value; '
    + 'public Counter(int value) { Value = value; Total = value; } }';
  const left = projectLibrary('Left]part', source);
  const right = projectLibrary('Right[part', source);
  const application = projectApplication('extern alias A; extern alias B; class P { static void Main() { '
    + 'var a = new A::Counter(20); var b = new B::Counter(22); '
    + 'System.Console.WriteLine(a.Value + b.Value); System.Console.WriteLine(A::Counter.Total + B::Counter.Total); } }',
  [{...left, aliases: ['A']}, {...right, aliases: ['B']}]);
  const graph = loadProjectAssembly(application.assembly, {dependencies: [dependency(right), dependency(left)]});
  const types = graph.image.types.filter(type => type.metadataName === 'Counter');
  assert.equal(types.length, 2);
  assert.equal(new Set(types.map(type => type.name)).size, 2);
  const result = new VirtualMachine(graph.image).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.output, '42\n42\n');
});

test('project type mappings use actual metadata identities and normalize reference assembly casing', () => {
  const compiled = projectLibrary('MixedCaseLibrary', 'public class Original { '
    + 'public Original Echo(Original value) { return value; } public int Number() { return 42; } }');
  const library = {...compiled, assembly: emitAssembly(compiled.image, {name: 'MixedCaseLibrary',
    typeDefinitions: {Original: {access: 'public', namespace: 'Example', name: 'Renamed'}}})};
  const application = projectApplication('var value = new Example.Renamed(); '
    + 'System.Console.WriteLine(value.Echo(value).Number());', [library]);
  const image = structuredClone(application.image);
  const reference = image.externalReferences.assemblies[0];
  const originalKey = reference.key;
  reference.identity.name = reference.identity.name.toLowerCase();
  reference.key = projectAssemblyKey(reference.identity);
  function qualify(value) {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
    for (const key of Object.keys(value)) {
      if (typeof value[key] === 'string') value[key] = value[key].replaceAll('[' + originalKey + ']', '[' + reference.key + ']');
      else qualify(value[key]);
    }
  }
  qualify(image);
  const graph = loadProjectAssembly(emitAssembly(image, {name: 'App'}), {dependencies: [dependency(library)]});
  const type = graph.image.types.find(type => type.metadataName === 'Example.Renamed');
  assert.equal(type.name, '[' + graph.modules[0].key + ']Example.Renamed');
  assert.equal(type.assemblyKey, graph.modules[0].key);
  const result = new VirtualMachine(graph.image).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.output, '42\n');
});

test('project dependency hashes and full identities reject stale or ambiguous outputs before execution', () => {
  const library = projectLibrary('Library', 'public class A { public static int Answer() { return 42; } }');
  const replacement = projectLibrary('Library', 'public class A { public static int Answer() { return 41; } }');
  const application = projectApplication('System.Console.WriteLine(A.Answer());', [library]);
  assert.throws(() => loadProjectAssembly(application.assembly), {code: 'PRJ0002'});
  assert.throws(() => loadProjectAssembly(application.assembly, {dependencies: [dependency(replacement)]}), {code: 'PRJ0003'});
  assert.throws(() => loadProjectAssembly(application.assembly,
    {dependencies: [dependency(library), dependency(replacement)]}), {code: 'PRJ0004'});
  const copy = {assembly: new Uint8Array(library.assembly)};
  assert.equal(loadProjectAssembly(application.assembly, {dependencies: [dependency(library), copy]}).modules.length, 2);
});

test('canonical single-module admission preserves unresolved target descriptors for later token verification', () => {
  const library = projectLibrary('Library', 'public class A { public static int Answer() { return 42; } }');
  const application = projectApplication('System.Console.WriteLine(A.Answer());', [library]);
  for (const mutate of [
    image => { image.externalReferences.methods[0].token = 0x0600ffff; },
    image => { image.externalReferences.methods[0].name = 'DifferentMethod'; },
    image => { image.externalReferences.types[0].token = 0x0200ffff; },
  ]) {
    const image = structuredClone(application.image);
    mutate(image);
    const bytes = emitAssembly(image, {name: 'App'});
    assert.deepEqual(loadAssembly(bytes).externalReferences, image.externalReferences);
    assert.throws(() => loadProjectAssembly(bytes, {dependencies: [dependency(library)]}), {code: 'PRJ0005'});
  }
});

test('noncanonical CIL, assembly budgets and caller cancellation fail before a runtime can observe effects', () => {
  const library = projectLibrary();
  const application = projectApplication('System.Console.WriteLine(Counter.Answer());', [library]);
  const corrupted = new Uint8Array(library.assembly);
  const inspector = new AssemblyInspector(corrupted);
  const method = [...inspector.methods.values()].find(method => method.name === 'Answer');
  const body = inspector.pe.methodBody(method.token);
  corrupted[body.code.byteOffset - inspector.pe.bytes.byteOffset] = 0xff;
  assert.throws(() => loadProjectAssembly(application.assembly, {dependencies: [{assembly: corrupted}]}), {code: 'PRJ0001'});
  assert.throws(() => loadProjectAssembly(new Uint8Array(projectReferenceLimits.assemblyBytes + 1)), {code: 'PRJ0006'});
  assert.throws(() => loadProjectAssembly(application.assembly,
    {dependencies: Array(projectReferenceLimits.assemblies + 1).fill(dependency(library))}), {code: 'PRJ0006'});
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => loadProjectAssembly(application.assembly, {signal: controller.signal}), {code: 'PRJ0007'});
});

test('real CLI type initializers preserve the existing source initialization helper and old canonical emission option', () => {
  const boundLibrary = projectLibrary();
  const boundInspector = new AssemblyInspector(boundLibrary.assembly);
  const boundInitializer = boundInspector.types.find(type => type.name === 'Counter').methods.find(method => method.name === '.cctor');
  assert(boundInspector.getMethod(boundInitializer.token).instructions.some(instruction => instruction.name === 'stsfld'));
  assert(loadAssembly(boundLibrary.assembly).methods.some(method => method.name === '.cctor'));
  const library = projectLibrary('SemanticLibrary', counterLibrarySource.replace('public class Counter {',
    'public class Counter { static Counter() { }'));
  const inspector = new AssemblyInspector(library.assembly);
  const definition = inspector.types.find(type => type.name === 'Counter');
  const initializer = definition.methods.find(method => method.name === '.cctor');
  assert(initializer, 'A native external static field read requires a real CLI type initializer');
  assert(inspector.getMethod(initializer.token).instructions.some(instruction => instruction.name === 'call'
    && inspector.resolveToken(instruction.operand).name === '<EnsureInitialized>'));
  assert.equal(loadAssembly(library.assembly).methods.filter(method => method.name === '<EnsureInitialized>').length, 1);
  const legacy = emitAssembly(library.image, {name: 'Library', projectStaticInitializers: false});
  assert.equal(new AssemblyInspector(legacy).types.find(type => type.name === 'Counter')
    .methods.some(method => method.name === '.cctor'), false);
  assert.equal(loadAssembly(legacy).types.length, library.image.types.length);
});

test('closed assembly images retain original resources, project attributes and assembly provenance', () => {
  const bytes = Uint8Array.of(1, 2, 3, 4);
  const attribute = {type: 'System.Reflection.AssemblyCompanyAttribute', value: 'Project Resources'};
  const library = projectLibrary('ResourceLibrary', undefined,
    {resources: [{manifestName: 'Library.Data', bytes}], assemblyAttributes: [attribute]});
  const application = projectApplication('System.Console.WriteLine(Counter.Answer());', [library]);
  const graph = loadProjectAssembly(application.assembly, {dependencies: [dependency(library)]});
  const module = graph.modules.find(module => module.identity.name === 'ResourceLibrary');
  assert.equal(module.resources[0].name, 'Library.Data');
  assert.equal(module.resources[0].size, 4);
  assert.equal(module.resources[0].bytes, undefined, 'Resource payloads are retained in the original owned PE');
  assert.deepEqual(readManagedResources(module.inspector.pe, {includeBytes: true})[0].bytes, bytes);
  assert.deepEqual(module.assemblyAttributes, [attribute]);
  const provenance = graph.image.assemblies.find(assembly => assembly.key === module.key);
  assert.deepEqual(provenance.resources, module.resources);
  assert.deepEqual(provenance.assemblyAttributes, [attribute]);
});
