import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { locateInteropToolchain, interopScratch } from './fixtures/exported-extension-blocks/dotnet.mjs';

const toolchain = locateInteropToolchain();
const skip = toolchain ? false : 'C# 14 native interoperability requires an installed .NET 10+ SDK and reference pack';
const librarySource = readFileSync(new URL('./fixtures/imported-extension-blocks/ExtensionLibrary.cs', import.meta.url), 'utf8');
const consumerSource = readFileSync(new URL('./fixtures/exported-extension-blocks/Consumer.cs', import.meta.url), 'utf8');
const expected = '8\n10\n9\n9\n6\n3\nTrue\nok\n3\n11\n12\n14\n';
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);

function emitted(source, emit = compileToAssembly, options = {}) {
  const result = emit(source, { name: 'ExtensionExports', outputKind: 'library', langVersion: '14',
    references: toolchain.references, ...options });
  assert.deepEqual(errors(result), []);
  assert.ok(result.assembly instanceof Uint8Array);
  return result.assembly;
}

for (const [description, emit] of [['executable', compileToAssembly], ['reference', compileToReferenceAssembly]]) {
  test(`A02-T83 a Roslyn client consumes SharpForge ${description} extension metadata and executes the real implementations`, { skip }, () => {
    const scratch = interopScratch(toolchain);
    try {
      const implementation = emitted(librarySource);
      scratch.write('ExtensionExports.dll', emit === compileToAssembly ? implementation : emitted(librarySource, emit));
      const client = scratch.compile(consumerSource);
      assert.equal(client.status, 0, client.output);
      const inspector = new AssemblyInspector(new Uint8Array(readFileSync(join(scratch.directory, 'Consumer.dll'))));
      const main = inspector.types.find(type => type.name === 'Program').methods.find(method => method.name === 'Main');
      const calls = inspector.getMethod(main.token).instructions.filter(instruction => instruction.name === 'call')
        .map(instruction => inspector.resolveToken(instruction.operand));
      for (const name of ['get_Twice', 'set_Writable', 'Add', 'New', 'Create', 'get_Item', 'get_Current', 'op_Addition']) {
        assert.ok(calls.some(call => call.owner === 'ExtensionImport.Extensions' && call.name === name), name + ' calls its original owner');
      }
      assert.ok(calls.every(call => !String(call.owner).includes('+<G>$')));
      scratch.write('ExtensionExports.dll', implementation);
      assert.equal(scratch.run(), expected);
    } finally {
      scratch.close();
    }
  });
}

test('A02-T83 Roslyn applies exported unmanaged and class constraints instead of exposing inapplicable extension members', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    scratch.write('ExtensionExports.dll', emitted(librarySource));
    const client = scratch.compile(`using ExtensionImport; class Program {
      static void Main() { bool invalid = Box<string>.IsUnmanaged; }
    }`);
    assert.notEqual(client.status, 0, 'the unmanaged constraint must reject string');
    assert.match(client.output, /CS8377|CS0315|CS0311/);
  } finally {
    scratch.close();
  }
});

test('A02-T83 Roslyn consumes static-only/property-only containers and a compiler-owned marker on the closed reference surface', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    const source = `public static class OnlyStatic { extension(int) { public static int Zero => 0; } }
      public static class OnlyProperty { extension(string text) { public int Triple => text.Length * 3; } }`;
    scratch.write('ExtensionExports.dll', emitted(source, compileToAssembly, { references: undefined }));
    const client = scratch.compile('using System; class Program { static void Main() { Console.WriteLine(int.Zero + "abc".Triple); } }');
    assert.equal(client.status, 0, client.output);
    assert.equal(scratch.run(), '9\n');
  } finally {
    scratch.close();
  }
});

test('A02-T83 marker skeleton methods throw while Roslyn calls the static implementation', { skip }, () => {
  const scratch = interopScratch(toolchain);
  try {
    scratch.write('ExtensionExports.dll', emitted(`public static class Extensions {
      extension(int number) { public static int Answer => 42; }
    }`));
    const client = scratch.compile(`using System; using System.Reflection;
      class Program { static void Main() {
        Console.WriteLine(int.Answer);
        foreach (var group in typeof(Extensions).GetNestedTypes(BindingFlags.Public)) {
          try { group.GetMethod("get_Answer").Invoke(null, null); }
          catch (TargetInvocationException error) { Console.WriteLine(error.InnerException is NotImplementedException); }
        }
      } }`);
    assert.equal(client.status, 0, client.output);
    assert.equal(scratch.run(), '42\nTrue\n');
  } finally {
    scratch.close();
  }
});

test('A02-T83 metadata-only static extension Main does not become an additional entry point', { skip }, () => {
  const source = `using System; public static class Extensions { extension(int) { public static int Main() => 4; } }
    class Program { static void Main() { Console.WriteLine(int.Main()); } }`;
  const scratch = interopScratch(toolchain);
  try {
    const reference = scratch.compile(source, { name: 'RoslynEntryPoint', library: null });
    assert.equal(reference.status, 0, reference.output);
    assert.equal(scratch.run('RoslynEntryPoint'), '4\n');
    const result = compileToAssembly(source, { name: 'Consumer', langVersion: '14', references: toolchain.references });
    assert.deepEqual(errors(result), []);
    scratch.write('Consumer.dll', result.assembly);
    assert.equal(scratch.run(), '4\n');
  } finally {
    scratch.close();
  }
});
