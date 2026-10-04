/**
 * SF-A02-T73: function pointers. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/function-pointers.js; these tests cover messages, boundaries and the
 * execution limit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { notExecutable } from './support/semantic-codegen.js';

const unsafe = { allowUnsafe: true };
const reported = (source, options = unsafe) =>
  compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
const messageOf = (source, code) => compile(source, unsafe).diagnostics.find(d => d.code === code)?.message;

test('SF-A02-T73 &Method selects the overload whose parameters are the pointer type\'s', () => {
  const source = `unsafe class Program {
  static void Log(string s) { }
  static void Log(int i) { }
  static string Text(object o) => "t";
  static void Main() {
    delegate*<string, void> a = &Log;
    delegate*<int, void> b = &Log;
    delegate*<object, object> covariant = &Text;
    delegate*<long, void> none = &Log;
    delegate*<object, int> wrong = &Text;
    a("x"); b(1);
  }
}
`;
  assert.deepEqual(reported(source), ['CS8757@&Log', 'CS0407@Text']);
  assert.equal(messageOf(source, 'CS8757'), "No overload for 'Log' matches function pointer 'delegate*<long, void>'");
});

test('SF-A02-T73 calling conventions: unmanaged pointers take [UnmanagedCallersOnly] methods only', () => {
  const source = `using System.Runtime.InteropServices;
unsafe class Program {
  static int Managed(int a) => a;
  [UnmanagedCallersOnly] static int Native(int a) => a;
  static void Main() {
    delegate*<int, int> a = &Managed;
    delegate* unmanaged<int, int> b = &Native;
    delegate* unmanaged<int, int> c = &Managed;
    delegate*<int, int> d = &Native;
    delegate* unmanaged[Stdcall]<int, int> e = &Native;
    delegate* unmanaged[Vectorcall]<int, int> f = null;
  }
}
`;
  assert.deepEqual(reported(source), ['CS8786@Managed', 'CS8786@Native', 'CS8786@Native', 'CS8890@Vectorcall']);
  assert.equal(messageOf(source, 'CS8890'), "Type 'CallConvVectorcall' is not defined.");
});

test('SF-A02-T73 conversions: implicit to void*, explicit between pointer types and integers, none to a delegate', () => {
  const source = `unsafe class Program {
  static int Add(int a, int b) => a + b;
  static void Main() {
    delegate*<int, int, int> add = &Add;
    void* raw = add;
    delegate*<int, int> narrowed = (delegate*<int, int>)add;
    long number = (long)add;
    int* data = (int*)add;
    delegate*<int, int, int> back = (delegate*<int, int, int>)raw;
    delegate*<int, int> implicitOther = add;
    System.Func<int, int, int> f = add;
    add = null;
  }
}
`;
  assert.deepEqual(reported(source), ['CS0266@add', 'CS0029@add']);
});

test('SF-A02-T73 a function pointer type needs an unsafe context, reported at delegate*', () => {
  const source = 'class Program { static void Main() { delegate*<int> p = null; } static delegate*<int> F() => null; }\n';
  assert.deepEqual(reported(source), ['CS0214@delegate*', 'CS0214@delegate*']);
  assert.deepEqual(reported(source.replace('class Program', 'unsafe class Program')), []);
});

test('SF-A02-T73 limit: function pointers bind but are not executable', () => {
  const source = `unsafe class Program {
  static int Add(int a, int b) => a + b;
  static void Main() { delegate*<int, int, int> f = &Add; System.Console.WriteLine(f(1, 2)); }
}
`;
  assert.deepEqual(reported(source), []);
  const result = compile(source, unsafe);
  assert.equal(result.image, null);
  assert.match(notExecutable(source, unsafe).message, /delegate\*<int, int, int>/);
});
