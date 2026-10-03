/**
 * SF-A02-T79 / SF-A02-T80: C# 12 rules. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/csharp12-rules.js; these tests cover `[Experimental]` (its diagnostic
 * ID is chosen by the program), evaluation order of collection expressions and the stated limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const errors = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && !d.code.startsWith('SF'))
    .map(d => `${d.code}@${d.start}`);

test('SF-A02-T80 a use of an [Experimental] type or member is an error with the ID the attribute names', () => {
  const source = `using System.Diagnostics.CodeAnalysis;
[Experimental("EXP001")] class Preview { public static void M() { } }
class Stable { [Experimental("EXP002")] public static void New() { } public static void Old() { } }
class Program { static void Main() { Preview.M(); Stable.New(); Stable.Old(); } }
`;
  const at = text => source.indexOf(text);
  assert.deepEqual(errors(source), [`EXP001@${at('Preview.M()')}`, `EXP002@${at('Stable.New()')}`]);
  const message = compile(source).diagnostics.find(d => d.code === 'EXP001').message;
  assert.match(message, /^'Preview' is for evaluation purposes only/);
});

test('SF-A02-T80 inside a declaration marked with the same ID the use is allowed', () => {
  const source = `using System.Diagnostics.CodeAnalysis;
[Experimental("EXP001")] class Preview { public static void M() { } static void Self() { Preview.M(); } }
class User {
  [Experimental("EXP001")] static void Allowed() { Preview.M(); }
  [Experimental("OTHER")] static void NotAllowed() { Preview.M(); }
}
class Program { static void Main() { } }
`;
  assert.deepEqual(errors(source), [`EXP001@${source.lastIndexOf('Preview.M()')}`]);
});

test('SF-A02-T79 elements and spreads of a collection expression are evaluated once, in order', () => {
  const source = `using System;
using System.Collections.Generic;
interface IMarker { }
class Program {
  static string order = "";
  static int V(int v) { order += v; return v; }
  static int[] A(int v) { order += "a" + v; return new int[] { v, v }; }
  static void Main() {
    List<int> list = [V(1), ..A(2), V(3)];
    int[] array = [V(4), ..A(5)];
    Console.WriteLine(list.Count + array.Length);
    Console.WriteLine(order);
  }
}
`;
  assert.deepEqual(linesOf(source), ['7', '1a234a5']);
});

test('SF-A02-T79 limits: interface and span targets bind but are not executable', () => {
  const toInterface = `using System.Collections.Generic;
interface IMarker { }
class Program { static void Main() { IEnumerable<int> e = [1, 2]; foreach (var v in e) System.Console.WriteLine(v); } }
`;
  assert.match(notExecutable(toInterface).message, /IEnumerable<int>/);
});
