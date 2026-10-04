import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function routes(source, expected, options = {}) {
  const compiled = compileToIL(source, options);
  assert.equal(compiled.success, true, compiled.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  const restored = loadAssembly(compiled.assembly);
  const machines = [new VirtualMachine(compiled.image, {sourceFusion: false}),
    new VirtualMachine(compiled.image, {sourceFusion: true}), new VirtualMachine(restored), new CilVirtualMachine(compiled.assembly)];
  for (const vm of machines) {
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  }
  return compiled;
}

test('source ref arguments retain local, static, object field and array identity across all routes', () => {
  routes(`using System;
    class Cell { public int Value; }
    class Program {
      static int Static;
      static void Alias(ref int first, ref int second) { first = 4; second += first; }
      static int Observe(in int value, ref int other) { other = 19; return value; }
      static void Main() {
        int local = 1; int[] array = { 1 }; Cell cell = new Cell();
        Alias(ref local, ref local); Alias(ref Static, ref Static);
        Alias(ref cell.Value, ref cell.Value); Alias(ref array[0], ref array[0]);
        Console.WriteLine(local + Static + cell.Value + array[0]);
        Console.WriteLine(Observe(in array[0], ref array[0]));
      }
    }`, '32\n19\n');
});

test('source ref locals and ref returns alias and reassign the actual location', () => {
  routes(`using System;
    class Program {
      static ref int First(int[] array) { return ref array[0]; }
      static void Main() {
        int[] a = { 2, 3 }; ref int value = ref First(a); value += 5;
        value = ref a[1]; value *= 4; Console.WriteLine(a[0] + a[1]);
      }
    }`, '19\n');
});

test('rectangular creation and dynamic dimensions preserve row-major enumeration and byref elements', () => {
  routes(`using System;
    class Program {
      static void Set(ref int item) { item = 20; }
      static void Main() {
        int[,] a = { { 1, 2, 3 }, { 4, 5, 6 } }; int dimension = 1;
        Set(ref a[1, 2]); int sum = 0; foreach (int item in a) sum += item;
        Console.WriteLine(sum); Console.WriteLine(a.GetLength(dimension));
        Console.WriteLine(a.Rank); Console.WriteLine(a.LongLength);
        try { int item = a[0, 3]; } catch (IndexOutOfRangeException) { Console.WriteLine("bounds"); }
        try { a.GetLength(2); } catch (IndexOutOfRangeException) { Console.WriteLine("dimension"); }
      }
    }`, '35\n3\n2\n6\nbounds\ndimension\n');
});

test('source array reflection retains non-zero lower bounds and true array identity', () => {
  routes(`using System;
    class Program { static void Main() {
      Array array = Array.CreateInstance(typeof(int), new int[] { 2, 3 }, new int[] { -2, 4 });
      array.SetValue(42, -1, 6); Console.WriteLine(array.GetValue(-1, 6));
      Console.WriteLine(array.GetLowerBound(0)); Console.WriteLine(array.GetUpperBound(1));
      int[,] typed = (int[,])array; Console.WriteLine(typed[-1, 6]);
      Array clone = (Array)array.Clone(); clone.SetValue(7, -1, 6);
      Console.WriteLine(array.GetValue(-1, 6)); Console.WriteLine(clone.GetValue(-1, 6));
    } }`, '42\n-2\n6\n42\n42\n7\n');
});

test('source Array.Copy overlap and Resize generic byref preserve aliases', () => {
  routes(`using System;
    class Program { static void Main() {
      int[] a = { 1, 2, 3, 4 }; int[] before = a;
      Array.Copy(a, 0, a, 1, 3); Array.Resize(ref a, 6);
      Console.WriteLine(a.Length); Console.WriteLine(before.Length);
      Console.WriteLine(a[1] + a[2] + a[3]); Array.Clear(a, 1, 2);
      Console.WriteLine(a[1] + a[2] + a[3]);
    } }`, '6\n4\n6\n3\n');
});

test('source stack spans, slices, readonly views and ref foreach share frame storage', () => {
  routes(`using System;
    class Program { static void Main() {
      Span<int> span = stackalloc int[] { 1, 2, 3, 4 };
      Span<int> slice = span.Slice(1, 2); ref int alias = ref slice[0]; alias = 9;
      foreach (ref int item in slice) item += 1;
      ReadOnlySpan<int> view = span; Console.WriteLine(view[1] + view[2]);
      Console.WriteLine(view.Length); Console.WriteLine(slice.ToArray()[0]);
      Span<int> empty = default; Console.WriteLine(empty.Length);
      try { int value = span[4]; } catch (IndexOutOfRangeException) { Console.WriteLine("bounds"); }
    } }`, '14\n4\n10\n0\nbounds\n');
});

test('array and string span conversions preserve mutable array aliases and readonly text', () => {
  routes(`using System;
    class Program { static void Main() {
      int[] array = { 1, 2, 3 }; Span<int> span = array; span[1] = 12;
      ReadOnlySpan<int> view = span; Console.WriteLine(array[1] + view[1]);
      ReadOnlySpan<char> text = "abc"; Console.WriteLine(text.Length); Console.WriteLine((int)text[1]);
    } }`, '24\n3\n98\n', {langVersion: '14'});
});

test('source ref escape and readonly writes remain compiler errors', () => {
  for (const source of [
    'class Program { static ref int Bad() { int x = 1; return ref x; } static void Main() {} }',
    'class Program { static void Bad(in int x) { x = 2; } static void Main() {} }',
    'using System; class Program { static Span<int> Bad() { Span<int> s = stackalloc int[1]; return s; } static void Main() {} }'
  ]) {
    const result = compile(source);
    assert.equal(result.success, false);
    assert(result.diagnostics.some(item => item.severity === 'error' && item.code.startsWith('CS')));
  }
});
