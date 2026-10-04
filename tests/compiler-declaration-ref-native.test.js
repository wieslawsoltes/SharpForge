import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { locateInteropToolchain, interopScratch } from './fixtures/exported-extension-blocks/dotnet.mjs';

const toolchain = locateInteropToolchain();
const skip = toolchain ? false : 'Declaration interoperability requires an installed .NET 10+ SDK and reference pack';
const source = readFileSync(new URL('./fixtures/exported-extension-blocks/DeclarationMetadata.cs', import.meta.url), 'utf8');
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);
const consumer = `using System; using DeclarationMetadata;
  class Derived : References {
    public override int Virtual(in int value, ref readonly int second) => value + second + 1;
  }
  class Program { static void Main() {
    int value = 5;
    Console.WriteLine(References.Read(in value));
    Console.WriteLine(References.Readonly(in value));
    ref readonly int result = ref References.Return(ref value);
    Console.WriteLine(result);
    References.Scope(ref value);
    Console.WriteLine(value);
    References.ScopedOut(out value);
    Console.WriteLine(value);
    Span<int> span = stackalloc int[2];
    Console.WriteLine(References.ScopedValue(span));
    ReadonlyDelegate action = References.Readonly;
    Console.WriteLine(action(in value));
    References instance = new Derived();
    Console.WriteLine(instance.Virtual(in value, in value));
    Console.WriteLine(value.ReadonlyValue);
    value.ScopedValue = 14;
    Console.WriteLine(value.ScopedValue);
    Console.WriteLine(new[] { 3 }.Head);
    Console.WriteLine(Generic<int>.Method<long>());
  } }`;
const expected = '5\n5\n5\n6\n1\n2\n1\n3\n1\n14\n3\nTrue\n';

function emitted(emit = compileToAssembly, references = toolchain.references) {
  const result = emit(source, { name: 'DeclarationExports', outputKind: 'library', langVersion: '14', references });
  assert.deepEqual(errors(result), []);
  assert.ok(result.assembly instanceof Uint8Array);
  return result.assembly;
}

for (const [description, emit] of [['executable', compileToAssembly], ['reference', compileToReferenceAssembly]]) {
  test(`A02-T83 Roslyn invokes ${description} readonly/scoped methods, delegate Invoke and a virtual override`, { skip }, () => {
    const scratch = interopScratch(toolchain);
    try {
      const implementation = emitted();
      scratch.write('DeclarationExports.dll', emit === compileToAssembly ? implementation : emitted(emit));
      const client = scratch.compile(consumer, { library: 'DeclarationExports' });
      assert.equal(client.status, 0, client.output);
      scratch.write('DeclarationExports.dll', implementation);
      assert.equal(scratch.run(), expected);
    } finally {
      scratch.close();
    }
  });
}

test('A02-T83 Roslyn rejects rvalues for exported ref readonly parameters and managed arguments for unmanaged constraints', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    scratch.write('DeclarationExports.dll', emitted());
    const readonly = scratch.compile('using DeclarationMetadata; class Program { static void Main() { References.Readonly(42); } }',
      { library: 'DeclarationExports', warnAsError: true });
    assert.notEqual(readonly.status, 0);
    assert.match(readonly.output, /CS9193/);
    const unmanaged = scratch.compile('using DeclarationMetadata; class Program { static void Main() { Generic<int>.Method<string>(); } }',
      { name: 'InvalidUnmanaged', library: 'DeclarationExports' });
    assert.notEqual(unmanaged.status, 0);
    assert.match(unmanaged.output, /CS8377/);
  } finally {
    scratch.close();
  }
});

test('A02-T83 native reflection constructs the locally embedded readonly, scoped, unmanaged and ref-safety attributes', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    scratch.write('DeclarationExports.dll', emitted(compileToAssembly, null));
    const client = scratch.compile(`using System; using System.Reflection; using DeclarationMetadata;
      class Program { static void Main() {
        var assembly = typeof(References).Assembly;
        foreach (var name in new[] { "IsReadOnlyAttribute", "RequiresLocationAttribute", "ScopedRefAttribute", "IsUnmanagedAttribute" }) {
          var type = assembly.GetType("System.Runtime.CompilerServices." + name, true);
          Console.WriteLine(Activator.CreateInstance(type) is Attribute);
          Console.WriteLine(type.GetCustomAttributes(false).Length >= 2);
        }
        var rules = assembly.GetType("System.Runtime.CompilerServices.RefSafetyRulesAttribute", true);
        var instance = Activator.CreateInstance(rules, new object[] { 11 });
        Console.WriteLine(rules.GetField("Version").GetValue(instance));
        Console.WriteLine(assembly.GetType("Microsoft.CodeAnalysis.EmbeddedAttribute", true).IsNotPublic);
      } }`, { library: 'DeclarationExports' });
    assert.equal(client.status, 0, client.output);
    assert.equal(scratch.run(), 'True\nTrue\nTrue\nTrue\nTrue\nTrue\nTrue\nTrue\n11\nTrue\n');
  } finally {
    scratch.close();
  }
});
