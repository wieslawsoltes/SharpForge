/**
 * Remainder of SF-A02-T72, T77 and T78. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/csharp9-11-remainder.js; these tests cover boundaries and limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { notExecutable } from './support/semantic-codegen.js';

const reported = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T72 [ModuleInitializer] on a local function is CS8813; another attribute of that name is not', () => {
  const source = `using System.Runtime.CompilerServices;
class Program {
  static void Main() {
    [ModuleInitializer] static void A() { }
    [ModuleInitializerAttribute] static void B() { }
    [System.Runtime.CompilerServices.ModuleInitializer] static void C() { }
    A(); B(); C();
  }
}
`;
  assert.deepEqual(reported(source), ['CS8813@ModuleInitializer', 'CS8813@ModuleInitializerAttribute', 'CS8813@System.Runtime.CompilerServices.ModuleInitializer']);
  const own = `class ModuleInitializerAttribute : System.Attribute { }
class Program { static void Main() { [ModuleInitializer] static void A() { } A(); } }
`;
  assert.deepEqual(reported(own), []);
});

test('SF-A02-T77 a UTF-8 literal is a ReadOnlySpan<byte>: joined with +, converted to nothing else', () => {
  const source = `using System;
class Program {
  static int Length(ReadOnlySpan<byte> bytes) => bytes.Length;
  static void Main() {
    var one = "a"u8;
    ReadOnlySpan<byte> two = "a"u8 + "b"u8;
    int n = Length("abc"u8) + Length("a"u8 + ("b"u8 + "c"u8)) + one.Length + two.Length;
    ReadOnlySpan<byte> mixed = "a"u8 + "b";
    ReadOnlySpan<byte> reversed = "a" + "b"u8;
    string text = "a"u8;
    byte[] array = "a"u8;
    object boxed = "a"u8;
    ReadOnlySpan<char> chars = "a"u8;
  }
}
`;
  assert.deepEqual(reported(source), [
    'CS0019@"a"u8 + "b"',
    'CS0019@"a" + "b"u8',
    'CS0029@"a"u8',
    'CS0029@"a"u8',
    'CS0029@"a"u8',
    'CS0029@"a"u8',
  ]);
  const message = compile(source).diagnostics.find(d => d.code === 'CS0019').message;
  assert.equal(message, "Operator '+' cannot be applied to operands of type 'System.ReadOnlySpan<byte>' and 'string'");
});

test('SF-A02-T77 limit: UTF-8 literals bind but are not executable (the runtime has no spans)', () => {
  const source = 'class Program { static void Main() { var b = "x"u8; System.Console.WriteLine(b.Length); } }\n';
  assert.deepEqual(reported(source), []);
  assert.match(notExecutable(source).message, /ReadOnlySpan<byte>/);
});

test('SF-A02-T78 scoped is gated as ref fields below C# 11, at the keyword, for parameters, locals and lambdas', () => {
  const source = `using System;
delegate void Take(scoped ref int value);
class Program {
  static void M(scoped ref int a, scoped in int b) { scoped Span<int> s = default; Take t = (scoped ref int v) => { }; }
  static void Main() { }
}
`;
  const gates = reported(source, { langVersion: '10' }).filter(entry => entry.startsWith('CS8936'));
  assert.deepEqual(gates, ['CS8936@scoped', 'CS8936@scoped', 'CS8936@scoped', 'CS8936@scoped', 'CS8936@scoped']);
  // At C# 11 only Roslyn's warning for the unused local is left: `s = default` is not a use of s (CS0219).
  assert.deepEqual(reported(source, { langVersion: '11' }), ['CS0219@s']);
  assert.match(compile(source, { langVersion: '10' }).diagnostics.find(d => d.code === 'CS8936').message, /^Feature 'ref fields' is not available in C# 10\.0/);
});
