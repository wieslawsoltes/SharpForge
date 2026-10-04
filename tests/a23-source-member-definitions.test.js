import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceText } from '@sharpforge/text';
import { parse } from '@sharpforge/syntax';
import { compile, compileToIL, sourceMemberDefinitions } from '@sharpforge/compiler';
import { AssemblyInspector, loadAssembly, loadProjectAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine, createProjectAssemblyInspector } from '@sharpforge/runtime';
import { compileNativeJsonProgram, resolveNativeReference } from './helpers/project-native-reference.js';

const accesses = { public: 6, internal: 3, private: 1, protected: 4, protectedInternal: 5, privateProtected: 2 };
const reference = bytes => ({ bytes, runtimeProfile: 'sharpforge' });
const apiSource = `namespace Boundary;
public class Api {
  public int PublicField;
  internal int InternalField;
  private int PrivateField;
  protected int ProtectedField;
  protected internal int ProtectedInternalField;
  private protected int PrivateProtectedField;
  public static int PublicMethod() { return 42; }
  internal static int InternalMethod() { return 42; }
  private static int PrivateMethod() { return 42; }
  protected static int ProtectedMethod() { return 42; }
  protected internal static int ProtectedInternalMethod() { return 42; }
  private protected static int PrivateProtectedMethod() { return 42; }
  public Api(int value) { PublicField = value; }
  internal Api() { PublicField = 1; }
  public int Value { get; private set; }
  public int ReadOnlyValue { get; } = 5;
}`;

function library(source = apiSource, options = {}) {
  const result = compileToIL(source, { name: 'Boundary', outputKind: 'library', ...options });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

test('source member definitions cover every image slot with exact access and private generated backing storage', () => {
  const files = [parse(new SourceText(apiSource, 'Api.cs'))];
  const compiled = compile(files, { name: 'Boundary', outputKind: 'library' });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const definitions = sourceMemberDefinitions(files, compiled.image);
  assert.equal(definitions.version, 1);
  assert.equal(definitions.methods.length, compiled.image.methods.length);
  assert.equal(definitions.fields.length, compiled.image.types.reduce((total, type) => total + type.fields.length, 0));
  assert.equal(definitions.statics.length, compiled.image.statics.length);
  const owner = compiled.image.types.find(type => type.name.endsWith('Api'));
  for (const [access] of Object.entries(accesses)) {
    const prefix = access[0].toUpperCase() + access.slice(1);
    const field = owner.fields.find(item => item.name === prefix + 'Field');
    const method = compiled.image.methods.find(item => item.name === prefix + 'Method');
    assert.equal(definitions.fields.find(item => item.type === owner.id && item.index === field.index).access, access);
    assert.equal(definitions.methods.find(item => item.id === method.id).access, access);
  }
  for (const field of owner.fields.filter(item => item.name.includes('k__BackingField'))) {
    const definition = definitions.fields.find(item => item.type === owner.id && item.index === field.index);
    assert.equal(definition.access, 'private');
    assert.equal(definition.isReadOnly, field.name.includes('ReadOnlyValue'));
  }
  const setter = compiled.image.methods.find(item => item.name === 'set_Value');
  assert.equal(definitions.methods.find(item => item.id === setter.id).access, 'private');
});

test('source member metadata disambiguates overloads and partial classes by source location', () => {
  const files = [
    parse(new SourceText('namespace N; public partial class Api { public static int M(int x) { return x; } }', 'A.cs')),
    parse(new SourceText('namespace N; public partial class Api { internal static string M(string x) { return x; } }', 'B.cs')),
  ];
  const compiled = compile(files, { outputKind: 'library' });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const definitions = sourceMemberDefinitions(files, compiled.image);
  for (const method of compiled.image.methods.filter(method => method.name === 'M')) {
    assert.equal(definitions.methods.find(item => item.id === method.id).access,
      method.parameters[0].type === 'int' ? 'public' : 'internal');
  }
  assert.throws(() => sourceMemberDefinitions(files, { types: [], methods: null, statics: [] }), /Invalid image members/);
  assert.throws(() => sourceMemberDefinitions(files, { types: [], methods: new Array(200001), statics: [] }), /definition limit/);
  assert.throws(() => sourceMemberDefinitions(files, { types: [{ name: 'Api' }], methods: [], statics: [] }), /field tables/);
});

test('compileToIL emits source access flags, constructor access and readonly backing fields into real metadata', () => {
  const result = library();
  const inspector = new AssemblyInspector(result.assembly);
  const api = inspector.types.find(type => type.name === 'Boundary.Api');
  assert(api);
  for (const [access, flags] of Object.entries(accesses)) {
    const prefix = access[0].toUpperCase() + access.slice(1);
    assert.equal(api.fields.find(field => field.name === prefix + 'Field').flags & 7, flags);
    assert.equal(api.methods.find(method => method.name === prefix + 'Method').flags & 7, flags);
  }
  const constructors = api.methods.filter(method => method.name === '.ctor')
    .filter(method => !inspector.signature(method.token).parameters.some(type => type.includes('AllocationToken')));
  assert.equal(constructors.find(method => inspector.signature(method.token).parameters.length === 1).flags & 7, 6);
  assert.equal(constructors.find(method => inspector.signature(method.token).parameters.length === 0).flags & 7, 3);
  assert.equal(api.methods.find(method => method.name === 'get_Value').flags & 7, 6);
  assert.equal(api.methods.find(method => method.name === 'set_Value').flags & 7, 1);
  const backing = api.fields.find(field => field.name === '<ReadOnlyValue>k__BackingField');
  assert.equal(backing.flags & 7, 1);
  assert.equal(backing.flags & 0x20, 0x20);
  assert.equal(loadAssembly(result.assembly).outputKind, 'library', 'Canonical loading retains metadata profile choices');
});

for (const [name, statement] of [
  ['internal method', 'return Boundary.Api.InternalMethod();'],
  ['private method', 'return Boundary.Api.PrivateMethod();'],
  ['internal field', 'return new Boundary.Api(1).InternalField;'],
  ['private field', 'return new Boundary.Api(1).PrivateField;'],
  ['internal constructor', 'return new Boundary.Api().PublicField;'],
]) {
  test(`separate project assembly rejects ${name} with CS0122`, () => {
    const dependency = library();
    const result = compileToIL(`public class Consumer { public static int M() { ${statement} } }`,
      { name: 'Consumer', outputKind: 'library', references: [reference(dependency.assembly)] });
    assert.equal(result.success, false);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === 'CS0122'), JSON.stringify(result.diagnostics));
  });
}

test('friend assembly access permits internal methods, fields and constructors while retaining private rejection', () => {
  const dependency = library(apiSource, { assemblyAttributes: [
    { type: 'System.Runtime.CompilerServices.InternalsVisibleToAttribute', value: 'Friend' },
  ] });
  const options = { name: 'Friend', outputKind: 'library', references: [reference(dependency.assembly)] };
  const accepted = compileToIL('public class Consumer { public static int M() { '
    + 'return Boundary.Api.InternalMethod() + new Boundary.Api().InternalField; } }', options);
  assert.equal(accepted.success, true, JSON.stringify(accepted.diagnostics));
  const rejected = compileToIL('public class Consumer { public static int M() { return Boundary.Api.PrivateMethod(); } }', options);
  assert.equal(rejected.success, false);
  assert(rejected.diagnostics.some(diagnostic => diagnostic.code === 'CS0122'), JSON.stringify(rejected.diagnostics));
});

test('readonly fields reject external writes and private setters remain inaccessible', () => {
  const dependency = library('public class Api { public readonly int Value = 2; '
    + 'public static readonly int Shared = 40; public int Property { get; private set; } }');
  const options = { name: 'Consumer', outputKind: 'library', references: [reference(dependency.assembly)] };
  for (const [statement, code] of [['new Api().Value = 3;', 'CS0191'], ['Api.Shared = 3;', 'CS0198']]) {
    const result = compileToIL(`public class Consumer { public static void M() { ${statement} } }`, options);
    assert.equal(result.success, false);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(result.diagnostics));
  }
  const result = compileToIL('public class Consumer { public static void M() { new Api().Property = 3; } }', options);
  assert.equal(result.success, false);
  assert(result.diagnostics.some(diagnostic => diagnostic.code === 'CS0272'), JSON.stringify(result.diagnostics));
});

test('semantic project properties retain metadata and reference only the accessors actually used', () => {
  const dependency = library('public class Api { public readonly int Marker = 1; '
    + 'public int Value { get; private set; } = 42; public int WriteOnly { private get; set; } '
    + 'public int Counter { get; set; } }');
  const inspector = new AssemblyInspector(dependency.assembly);
  assert.equal(inspector.metadata.counts[23], 3, 'Each semantic property has a real Property row');
  const image = loadAssembly(dependency.assembly);
  const properties = image.types.find(type => type.name === 'Api').properties;
  assert.deepEqual(properties.map(property => property.name), ['Value', 'WriteOnly', 'Counter']);
  const options = { name: 'Consumer', references: [reference(dependency.assembly)] };
  const application = compileToIL('var api = new Api(); api.WriteOnly = 1; api.Counter = 40; api.Counter += 2; '
    + 'System.Console.WriteLine(api.Value); System.Console.WriteLine(api.Counter);', options);
  assert.equal(application.success, true, JSON.stringify(application.diagnostics));
  const methods = application.image.externalReferences.methods.map(method => method.name);
  for (const expected of ['get_Value', 'set_WriteOnly', 'get_Counter', 'set_Counter']) assert(methods.includes(expected));
  for (const unused of ['set_Value', 'get_WriteOnly']) assert.equal(methods.includes(unused), false);
  const graphOptions = { dependencies: [{ assembly: dependency.assembly }] };
  const graph = loadProjectAssembly(application.assembly, graphOptions);
  const direct = createProjectAssemblyInspector(application.assembly, graphOptions);
  for (const machine of [new VirtualMachine(graph.image), new CilVirtualMachine(direct)]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '42\n42\n');
  }
  const inaccessible = compileToIL('System.Console.WriteLine(new Api().WriteOnly);', options);
  assert.equal(inaccessible.success, false);
  assert(inaccessible.diagnostics.some(diagnostic => diagnostic.code === 'CS0271'), JSON.stringify(inaccessible.diagnostics));
});

test('synthesized parameterless constructors retain public access when instance initialization creates an image body', () => {
  const dependency = library('namespace N; public class Api { public readonly int Value = 42; }');
  const inspector = new AssemblyInspector(dependency.assembly);
  const api = inspector.types.find(type => type.name === 'N.Api');
  const constructor = api.methods.find(method => method.name === '.ctor' && !inspector.signature(method.token).parameters.length);
  assert(constructor);
  assert.equal(constructor.flags & 7, 6);
  const consumer = compileToIL('System.Console.WriteLine(new N.Api().Value);',
    { name: 'Consumer', references: [reference(dependency.assembly)] });
  assert.equal(consumer.success, true, JSON.stringify(consumer.diagnostics));
  const imported = consumer.image.externalReferences.methods.find(method => method.name === '.ctor');
  assert.deepEqual(imported.parameters, []);
  assert.equal(imported.token, constructor.token, 'The descriptor selects the public constructor, never the allocation helper');
});

test('the installed CLR initializes and reads emitted instance and static readonly fields', {
  skip: !process.env.SHARPFORGE_DOTNET && 'Set SHARPFORGE_DOTNET for the actual CLR readonly oracle',
  timeout: 60000,
}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'sf-readonly-metadata-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const dependency = library('public class Api { public readonly int Value = 1; public static readonly int Shared = 40; '
    + 'public Api(int value) { Value = value; } public int Read() { return Value + Shared; } }');
  const path = join(directory, 'Boundary.dll');
  await writeFile(path, dependency.assembly);
  const toolchain = resolveNativeReference(process.env.SHARPFORGE_DOTNET, process.env.SHARPFORGE_NATIVE_SDK ?? '10.0.201');
  const execute = compileNativeJsonProgram(toolchain, directory, `using System;
using System.Reflection;
using System.Text.Json;
class Probe {
  static void Main(string[] args) {
    var api = Assembly.LoadFrom(args[0]).GetType("Api");
    var instance = Activator.CreateInstance(api, new object[] { 2 });
    Console.WriteLine(JsonSerializer.Serialize(new {
      value = (int)api.GetField("Value").GetValue(instance),
      shared = (int)api.GetField("Shared").GetValue(null),
      result = (int)api.GetMethod("Read").Invoke(instance, null),
      valueReadonly = api.GetField("Value").IsInitOnly,
      sharedReadonly = api.GetField("Shared").IsInitOnly
    }));
  }
}`);
  assert.deepEqual(execute([path]), { value: 2, shared: 40, result: 42, valueReadonly: true, sharedReadonly: true });
  context.diagnostic(JSON.stringify({ sdk: toolchain.sdk, runtime: toolchain.runtime,
    platform: process.platform, architecture: process.arch, actualClrReadonlyInitialization: true }));
});
