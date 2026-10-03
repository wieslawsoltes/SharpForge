/**
 * SF-A02-T75 and the C# 10 rules of SF-A02-E09. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/csharp10-rules.js; these tests cover boundary cases and the stated
 * limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

// The C# errors; a program outside the execution profile also keeps the profile's own (SFxxxx) diagnostics.
const errors = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => d.code);
const program = (members, body) => `using System;\nclass Program {\n${members}\n  static void Main() {\n${body}\n  }\n}\n`;

test('SF-A02-T75 a constant interpolated string keeps escaped braces and nests through other constants', () => {
  const source = program(
    '  const string Name = "n";\n  const string Braces = $"{{{Name}}}";\n  const string Verbatim = $@"{Name}\\{Braces}";',
    '    Console.WriteLine(Braces);\n    Console.WriteLine(Verbatim);\n    const string Empty = $"";\n    Console.WriteLine(Empty.Length);',
  );
  assert.deepEqual(linesOf(source), ['{n}', 'n\\{n}', '0']);
});

test('SF-A02-T75 an interpolated string with a non-constant hole is still an ordinary string', () => {
  const source = program('  const string A = "a";', '    int n = 2;\n    string s = $"{A}{n}";\n    Console.WriteLine(s);');
  assert.deepEqual(linesOf(source), ['a2']);
});

test('SF-A02-T75 [CallerArgumentExpression] uses the declared default when its target is omitted too', () => {
  const source = `using System;
using System.Runtime.CompilerServices;
class Program {
  static string Describe(int a = 5, int b = 6, [CallerArgumentExpression("b")] string text = "default") => text;
  static void Main() {
    Console.WriteLine(Describe());
    Console.WriteLine(Describe(1));
    Console.WriteLine(Describe(1, 2 * 3));
    Console.WriteLine(Describe(b: 7 - 1));
    Console.WriteLine(Describe(1, 2, "given"));
  }
}
`;
  assert.deepEqual(linesOf(source), ['default', 'default', '2 * 3', '7 - 1', 'given']);
});

test('SF-A02-T75 an explicit lambda return type is the inferred return type of a generic call', () => {
  const source = `using System;
class Program {
  static T Run<T>(Func<T> f) => f();
  static void Main() { var text = Run(string () => "s"); Console.WriteLine(text.Length); }
}
`;
  // Generic methods are outside what the runtime executes; the call binds with T = string.
  assert.deepEqual(errors(source), []);
});

test('SF-A02-T75 a lambda returned by a lambda has its natural type; without one the outer lambda has none either', () => {
  assert.deepEqual(linesOf(program('', '    var make = () => (int v) => v * 3;\n    Console.WriteLine(make()(4));')), ['12']);
  assert.deepEqual(errors(program('', '    var make = () => x => x;')), ['CS8917']);
});

test('SF-A02-T75 a member path in a property pattern stops at the first null', () => {
  const source = `using System;
class Node { public Node Next; public int Value; public Node(int value, Node next) { Value = value; Next = next; } }
class Program {
  static string Describe(Node n) => n switch {
    { Next.Next.Value: 3 } => "third is 3",
    { Next.Value: > 1 } => "second above 1",
    { Value: 1 } => "first is 1",
    _ => "other",
  };
  static void Main() {
    Console.WriteLine(Describe(new Node(1, new Node(2, new Node(3, null)))));
    Console.WriteLine(Describe(new Node(1, new Node(2, null))));
    Console.WriteLine(Describe(new Node(1, null)));
    Console.WriteLine(Describe(null));
  }
}
`;
  assert.deepEqual(linesOf(source), ['third is 3', 'second above 1', 'first is 1', 'other']);
});

test('SF-A02-T75 limits: conversion of a natural function type to System.Delegate and structs are not executable', () => {
  const toDelegate = program('  static int F(int v) => v;', '    Delegate d = F;\n    Console.WriteLine(d != null);');
  assert.match(notExecutable(toDelegate).message, /System\.Delegate/);
  const structWithInitializer = `struct S { public int X = 5; public S() { } }\nclass Program { static void Main() { var s = new S(); System.Console.WriteLine(s.X); } }\n`;
  assert.match(notExecutable(structWithInitializer).message, /struct/);
});
