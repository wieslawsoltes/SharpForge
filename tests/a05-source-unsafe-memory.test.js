import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {livePinCount} from '../packages/runtime/src/execution/pinned.js';

function execute(source, expected, {fault = null} = {}) {
  const compiled = compileToIL(source, {allowUnsafe: true});
  assert.equal(compiled.success, true, compiled.diagnostics.map(item => item.code + ': ' + item.message).join('\n'));
  const image = loadAssembly(compiled.assembly);
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(image), new CilVirtualMachine(compiled.assembly)]) {
    try {
      const result = vm.run();
      assert.equal(result.fault?.name ?? null, fault, JSON.stringify(result.fault));
      assert.equal(result.output, expected);
      assert.equal(livePinCount(vm), 0, 'lexical cleanup releases every pin');
    } finally { vm.stop(); }
  }
}

test('fixed array interiors remain rooted through collection and release at scope exit', () => {
  execute(`using System;
    unsafe class Program { static void Main() {
      int[] values = { 2, 3, 4 };
      fixed (int* pointer = values) {
        values = null; GC.Collect(); pointer[1] = 7; Console.WriteLine(pointer[1]);
        int* next = pointer + 2; Console.WriteLine(next - pointer); Console.WriteLine(next > pointer);
      }
    } }`, '7\n2\nTrue\n');
});

test('fixed pin cleanup runs through return and caught exceptions', () => {
  execute(`using System;
    unsafe class Program {
      static int Read(int[] values) { fixed (int* pointer = values) { pointer[0] = 8; return pointer[0]; } }
      static void Main() {
        int[] values = { 1 }; Console.WriteLine(Read(values));
        try { fixed (int* pointer = values) { pointer[0] = 9; throw new Exception("stop"); } }
        catch (Exception) { Console.WriteLine(values[0]); }
      }
    }`, '8\n9\n');
});

test('fixed null and empty arrays produce null pointers without creating a pin', () => {
  execute(`using System;
    unsafe class Program { static void Main() {
      int[] missing = null; fixed (int* pointer = missing) { Console.WriteLine(pointer == null); }
      int[] empty = new int[0]; fixed (int* pointer = empty) { Console.WriteLine(pointer == null); }
    } }`, 'True\nTrue\n');
});

test('raw stack allocation supports typed addresses, offsets, mutation and local address conversion', () => {
  execute(`using System;
    unsafe class Program { static void Main() {
      int* pointer = stackalloc int[3] { 1, 2, 3 }; pointer[1] += 5;
      int* next = pointer; next++; *next += 1; Console.WriteLine(pointer[1]);
      int local = 11; int* address = &local; *address = 12; Console.WriteLine(local);
      Console.WriteLine(sizeof(int));
    } }`, '8\n12\n4\n');
});

test('a pointer escaping its fixed scope is revoked before the next memory access', () => {
  execute(`unsafe class Program { static void Main() {
    int[] values = { 1 }; int* escaped;
    fixed (int* pointer = values) { escaped = pointer; }
    int value = escaped[0];
  } }`, '', {fault: 'InvalidProgramException'});
});

test('a later fixed initializer fault releases earlier pins before the enclosing catch runs', () => {
  const compiled = compileToIL(`using System; unsafe class Program { static void Main() {
    int[] values = { 1 };
    try { fixed (int* first = &values[0], second = &values[2]) { Console.WriteLine(*first); } }
    catch (IndexOutOfRangeException) { Console.WriteLine("caught"); }
  } }`, {allowUnsafe: true});
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const image = loadAssembly(compiled.assembly);
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(image), new CilVirtualMachine(compiled.assembly)]) {
    const counts = [];
    vm.onOutput = () => { counts.push(livePinCount(vm)); };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, 'caught\n');
      assert.deepEqual(counts, [0], 'the first pin is released before control reaches the surrounding catch');
    } finally { vm.stop(); }
  }
});
