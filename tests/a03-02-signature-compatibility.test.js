import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { decodeTypeSignature, parseSignatureType, readTypeSignature } from '@sharpforge/cil';

test('declared metadata names are atomic even when they contain signature punctuation', () => {
  const declared = { kind: 'class', token: 0x02000001 };
  const namedTypes = new Map([
    ['<>Cell(int)', declared], ['ValueTuple(int;string)', declared],
    ['Func(int, string)', declared], ['<PrivateImplementationDetails>', declared],
  ]);
  for (const name of namedTypes.keys()) {
    assert.deepEqual(parseSignatureType(name, undefined, { namedTypes }), declared, name);
    assert.deepEqual(parseSignatureType(`${name}[]`, undefined, { namedTypes }), { kind: 'szarray', element: declared });
  }
  assert.throws(() => parseSignatureType('List<int,,string>', () => 0x01000001), /nonempty/);
});

test('legacy type inspection accepts byrefs while TypeSpec decoding remains strict', () => {
  assert.equal(readTypeSignature(Uint8Array.of(0x10, 8)), 'int&');
  assert.equal(readTypeSignature(Uint8Array.of(1)), 'void');
  assert.throws(() => decodeTypeSignature(Uint8Array.of(0x10, 8)), /Byref/);
  assert.throws(() => decodeTypeSignature(Uint8Array.of(1)), /Void/);
});

test('compiler synthesized closure, delegate, tuple and iterator classes retain their identities', () => {
  const source = `
    using System;
    using System.Collections.Generic;
    class Program {
      static IEnumerable<int> Values() { yield return 7; }
      static void Main() {
        int count = 1;
        Func<int, int> next = x => count += x;
        var pair = (next(2), "tuple");
        Console.WriteLine(pair.Item1);
        Console.WriteLine(pair.Item2);
        foreach (var value in Values()) Console.WriteLine(value);
      }
    }`;
  const result = compileToIL(source, { includeDebug: false });
  assert.ok(result.success, JSON.stringify(result.diagnostics));
  const execution = new CilVirtualMachine(result.assembly).run();
  assert.equal(execution.state, 'terminated', execution.fault?.stack);
  assert.equal(execution.output, '3\ntuple\n7\n');
});
