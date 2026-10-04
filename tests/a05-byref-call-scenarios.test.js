import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';
import {source, expected} from '../examples/runtime/managed-references.mjs';
import {executeExample} from '../examples/runtime/example-routes.mjs';

for (const sourceFusion of [false, true]) {
  test(`T02.8 Swap, out, ref-returning indexers and in structs share storage across all routes; fusion=${sourceFusion}`, () => {
    const results = executeExample(source, expected, {vmOptions: {sourceFusion}});
    assert.deepEqual(results.map(result => result.engine), ['source', 'reloaded source', 'direct CIL']);
    for (const result of results) {
      assert.equal(result.output, expected, result.engine);
      assert.ok(result.instructions > 0, result.engine);
    }
  });
}

test('T02.8 indexer getter metadata returns an owned byref rather than a copied scalar', () => {
  const artifact = compileToIL(source, {pipeline: 'bound'});
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  const inspector = new AssemblyInspector(artifact.assembly);
  const getter = [...inspector.methods.values()].find(method => method.owner === 'Buffer' && method.name === 'get_Item');
  assert.ok(getter);
  assert.equal(inspector.getMethod(getter.token).signature.returnType, 'int&');
});

test('T02.8 ref indexers cannot expose expired local storage or writable aliases to readonly results', () => {
  const invalid = [
    `class Buffer { public ref int this[int index] { get { int local = index; return ref local; } } }
      class Program { static void Main() {} }`,
    `class Buffer { private int[] items = new int[1]; public ref readonly int this[int index] { get { return ref items[index]; } } }
      class Program { static void Assign(out int value) { value = 1; }
        static void Main() { Buffer buffer = new Buffer(); Assign(out buffer[0]); } }`
  ];
  for (const text of invalid) {
    const artifact = compileToIL(text, {pipeline: 'bound'});
    assert.equal(artifact.success, false);
    assert.ok(artifact.diagnostics.some(diagnostic => diagnostic.severity === 'error' && diagnostic.code.startsWith('CS')));
  }
});

test('T02.8 ref indexer assignment, compound assignment and postfix evaluate the address once before the value', () => {
  const text = `using System;
    class Buffer {
      public int Reads;
      private int[] values = new int[1];
      public ref int this[int index] { get { Reads++; Console.Write("G"); return ref values[index]; } }
    }
    class Program {
      static Buffer buffer = new Buffer();
      static Buffer Receiver() { Console.Write("R"); return buffer; }
      static int Index() { Console.Write("I"); return 0; }
      static int Value() { Console.Write("V"); return 4; }
      static void Main() {
        Receiver()[Index()] = Value(); Console.WriteLine(); Console.WriteLine(buffer.Reads);
        Receiver()[Index()] += Value(); Console.WriteLine(); Console.WriteLine(buffer.Reads);
        Console.WriteLine(Receiver()[Index()]++); Console.WriteLine(buffer.Reads);
        Console.WriteLine(buffer[0]);
      }
    }`;
  const trace = 'RIGV\n1\nRIGV\n2\nRIG8\n3\nG9\n';
  const results = executeExample(text, trace);
  assert.equal(results.length, 3);
  for (const result of results) assert.equal(result.output, trace, result.engine);
});
