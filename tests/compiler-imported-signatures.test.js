import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly, createReferenceSet } from '@sharpforge/compiler';
import { locateReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';

// SF-A02-T30: a source method that overrides or implements an imported member repeats its custom modifiers.
// Reference: packages/compiler/test/imported-signatures - Library.dll is the Roslyn 5.3.0 build of Library.cs, and
// Consumer.cs compiled by SharpForge against it prints on .NET 10 what the Roslyn build of Consumer.cs prints
// (verify-dotnet.mjs, SDK 10.0.201, reference pack 10.0.5). These tests read the emitted signatures; they need the
// reference pack of an installed .NET SDK and are skipped without one.

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'compiler', 'test', 'imported-signatures');
const pack = locateReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';
const BYREF = 0x10,
  CMOD_REQUIRED = 0x1f,
  INT32 = 0x08;

function compileAgainstLibrary(source) {
  const references = createReferenceSet(readReferenceFiles([...pack.files, join(directory, 'Library.dll')])),
    result = compileToAssembly(source, { name: 'Consumer', references }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    metadata = inspector.metadata;
  return {
    /** The MethodDefSig bytes of `Type::Method`. */
    signature(typeName, methodName) {
      const type = inspector.types.find(candidate => candidate.name === typeName) ?? assert.fail(`no type ${typeName}`),
        named = candidate => candidate.name === methodName || candidate.name.endsWith('.' + methodName),
        method = type.methods.find(named) ?? assert.fail(`no method ${typeName}::${methodName}: ${type.methods.map(m => m.name).join(', ')}`);
      return [...metadata.blob(metadata.row(method.token)[4])];
    },
    /** The name of the type a `modreq` at `offset` of a signature names. */
    modifier(bytes, offset) {
      assert.equal(bytes[offset], CMOD_REQUIRED, bytes.join(','));
      const coded = bytes[offset + 1],
        token = ((coded & 3) === 1 ? 0x01000000 : (coded & 3) === 0 ? 0x02000000 : 0x1b000000) | (coded >>> 2);
      return metadata.typeName(token);
    },
  };
}
const IN = 'System.Runtime.InteropServices.InAttribute';
const INIT = 'System.Runtime.CompilerServices.IsExternalInit';

test('A02-T30 an override repeats modreq(InAttribute) of an in parameter and of a ref readonly return', { skip }, () => {
  const emitted = compileAgainstLibrary(readFileSync(join(directory, 'Consumer.cs'), 'utf8'));
  // instance int32 Area(modreq(In) int32&): the modifier precedes BYREF, as Roslyn wrote it in Library.dll.
  const area = emitted.signature('Square', 'Area');
  assert.deepEqual(area.slice(0, 3), [0x20, 0x01, INT32]);
  assert.equal(emitted.modifier(area, 3), IN);
  assert.deepEqual(area.slice(-2), [BYREF, INT32]);
  // instance modreq(In) int32& get_Corner()
  const corner = emitted.signature('Square', 'get_Corner');
  assert.deepEqual(corner.slice(0, 2), [0x20, 0x00]);
  assert.equal(emitted.modifier(corner, 2), IN);
  assert.deepEqual(corner.slice(-2), [BYREF, INT32]);
  // Only the `in` parameter of Describe(in long, ref int, out int) is modified.
  const describe = emitted.signature('Square', 'Describe');
  assert.equal(describe.filter(byte => byte === CMOD_REQUIRED).length, 1);
});

test('A02-T30 the modifiers pass through a source override in between, and to interface implementations', { skip }, () => {
  const emitted = compileAgainstLibrary(readFileSync(join(directory, 'Consumer.cs'), 'utf8'));
  assert.deepEqual(emitted.signature('Cube', 'Area'), emitted.signature('Square', 'Area'));
  const implicit = emitted.signature('Ruler', 'Measure');
  assert.equal(emitted.modifier(implicit, 3), IN);
  const explicit = emitted.signature('ExplicitRuler', 'Measure');
  assert.equal(emitted.modifier(explicit, 3), IN);
  for (const type of ['Square', 'Ruler']) {
    const setter = emitted.signature(type, type === 'Square' ? 'set_Size' : 'set_Tag');
    assert.equal(emitted.modifier(setter, 2), INIT, type);
  }
  // A generic base: `T Pick(in T, in T)` overridden for `int` keeps both modifiers.
  assert.equal(emitted.signature('Larger', 'Pick').filter(byte => byte === CMOD_REQUIRED).length, 2);
});

test('A02-T30 a source method that overrides nothing imported has no custom modifiers', { skip }, () => {
  const emitted = compileAgainstLibrary(`abstract class Local { public abstract int M(in int x); }
    class Derived : Local { public override int M(in int x) { return x; } public int Plain(in int x) { return x; } }
    class P { static void Main() { int one = 1; System.Console.WriteLine(new Derived().M(in one)); } }`);
  for (const [type, method] of [
    ['Local', 'M'],
    ['Derived', 'M'],
    ['Derived', 'Plain'],
  ]) {
    assert.deepEqual(emitted.signature(type, method), [0x20, 0x01, INT32, BYREF, INT32], `${type}::${method}`);
  }
});
