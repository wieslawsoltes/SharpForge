import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { AssemblyInspector } from '@sharpforge/cil';

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

