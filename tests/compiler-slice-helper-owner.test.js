/**
 * Slice patterns over arrays copy the range with a synthesized static helper. Its declaring class must keep a metadata
 * name that the CIL execution profile reads as one declared type: a name of the shape `<Name>` is split there into a
 * generic instantiation with an empty definition, and the call then faults on the generic arity check (issue #1,
 * found after #3562).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { AssemblyInspector, genericTypeParts } from '@sharpforge/cil';

const SOURCE = `
using System;
class Program
{
    static void Main()
    {
        int[] numbers = { 1, 2, 3, 4 };
        if (numbers is [1, .. var middle, 4]) Console.WriteLine(middle.Length + " " + middle[0] + middle[1]);
        if (numbers is [.. var all]) Console.WriteLine(all.Length + " " + (all == numbers));
        string[] words = { "a", "b", "c" };
        if (words is [_, .. var rest]) Console.WriteLine(rest.Length + rest[0] + rest[1]);
        if (numbers is [.. var head, _, _, _, _]) Console.WriteLine(head.Length);
    }
}
`;
// What the same program prints on .NET 10 (SDK 10.0.201).
const EXPECTED = '2 23\n4 False\n2bc\n0\n';
const OPTIONS = { maxInstructions: 1_000_000 };

test('slice pattern sub-arrays run on the bytecode and the CIL back end', () => {
  const image = compile(SOURCE);
  assert.deepEqual(image.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  const bytecode = new VirtualMachine(image.image, OPTIONS).run();
  assert.equal(bytecode.state, 'terminated');
  assert.equal(bytecode.output, EXPECTED);

  const assembly = compileToIL(SOURCE, { includeDebug: false });
  assert.equal(assembly.success, true);
  const cil = new CilVirtualMachine(assembly.assembly, OPTIONS).run();
  assert.equal(cil.state, 'terminated', String(cil.fault?.message ?? cil.fault ?? ''));
  assert.equal(cil.output, EXPECTED);
});

test('the slice helpers live in one non-generic class whose name is a single declared type name', () => {
  const assembly = compileToIL(SOURCE, { includeDebug: false });
  const inspector = new AssemblyInspector(assembly.assembly);
  const owners = inspector.types.filter(type => type.methods.some(method => method.name.startsWith('GetSubArray(')));
  assert.equal(owners.length, 1);
  const helpers = owners[0].methods.filter(method => method.name.startsWith('GetSubArray(')).map(method => method.name);
  assert.deepEqual(helpers.sort(), ['GetSubArray(int)', 'GetSubArray(string)']);
  assert.equal((inspector.metadata.rows[42] ?? []).length, 0, 'no GenericParam rows: the helpers are monomorphic');
  assert.equal((inspector.metadata.rows[43] ?? []).length, 0, 'no MethodSpec rows');
  for (const type of inspector.types.filter(candidate => candidate.methods.length)) {
    assert.deepEqual(genericTypeParts(type.name).arguments, [], `${type.name} reads as a generic instantiation`);
  }
});
