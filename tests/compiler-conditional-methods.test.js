/**
 * SF-A02-T52: conditional methods. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/conditional-methods.js; these tests cover the symbol sources (option,
 * #define, #undef). A method with an attribute is outside the execution profile, so these programs are generated from
 * the semantic bound trees, where the omission is implemented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

const program = (prefix = '') => `${prefix}using System;
using System.Diagnostics;
class Program {
  static int calls;
  static int Next() { calls++; return calls; }
  [Conditional("DEBUG")] static void Note(int value) { Console.WriteLine("debug " + value); }
  [Conditional("DEBUG"), Conditional("TRACE")] static void Either(int value) { Console.WriteLine("either " + value); }
  static void Main() { Note(Next()); Either(Next()); Console.WriteLine(calls); }
}
`;

test('SF-A02-T52 a call to a conditional method is not executed when none of its symbols is defined', () => {
  assert.deepEqual(linesOf(program()), ['0']);
});

test('SF-A02-T52 #define, #undef and the preprocessorSymbols option decide per file', () => {
  assert.deepEqual(linesOf(program('#define DEBUG\n')), ['debug 1', 'either 2', '2']);
  assert.deepEqual(linesOf(program('#define TRACE\n')), ['either 1', '1']);
  assert.deepEqual(linesOf(program(), { preprocessorSymbols: ['DEBUG'] }), ['debug 1', 'either 2', '2']);
  assert.deepEqual(linesOf(program('#undef DEBUG\n'), { preprocessorSymbols: 'DEBUG;TRACE' }), ['either 1', '1']);
});

test('SF-A02-T52 an omitted call in a program the generator cannot lower is an error, never an executed call', () => {
  const source = `using System;
using System.Diagnostics;
class Program {
  [Conditional("DEBUG")] static void Note() { Console.WriteLine("debug"); }
  static void Main() { Note(); lock ("gate") { } }
}
`;
  const result = compile(source);
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.ok(result.diagnostics.some(d => d.code === 'SF2200'));
});

test('SF-A02-T52 a conditional method returns void and is not an override or an interface member', () => {
  const source = `using System.Diagnostics;
interface I { [Conditional("A")] void M(); }
class B { public virtual void V() { } }
class C : B {
  [Conditional("A")] static int R() { return 0; }
  [Conditional("A")] public override void V() { }
  [Conditional("1A")] static void N() { }
  static void Main() { }
}
`;
  const codes = compile(source)
    .diagnostics.filter(d => /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
  assert.deepEqual(codes, ['CS0582 Conditional("A")', 'CS0578 Conditional("A")', 'CS0243 Conditional("A")', 'CS0633 "1A"']);
});
