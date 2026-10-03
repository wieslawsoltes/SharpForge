import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';
import { expressionVariableNames } from '../packages/compiler/src/binder/expression-variables.js';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';

// SF-A02-T63: out variables, discards and the scope of expression variables.

/** The C# errors of a program as `code text`, where text is the source the diagnostic covers. */
function errorsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
const helpers = `static bool T(out int v) { v = 1; return true; } static void S(out string s) { s = ""; }`;
const inMain = (statements, members = '') =>
  `using System; class Program { ${helpers} ${members} static void Main(string[] args) { ${statements} } }`;

/** The statements of `Main` in a parsed program. */
function statementsOf(text) {
  const root = parse(new SourceText(inMain(text))).syntax;
  const find = node => {
    if (node.kind === 'MethodDeclaration' && node.identifier.valueText === 'Main') return node;
    for (const child of node.childNodes()) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return [...find(root).body.statements];
}

test('SF-A02-T63 out variables take the type of the parameter of the chosen overload', () => {
  const lines = linesOf(`using System;
    class Program {
      static void M(out int x) { x = 1; }
      static void M(out string x, int y) { x = "s"; }
      static bool TryGet(int k, out int v) { v = k * 2; return k > 0; }
      static void Main() {
        M(out var a); M(out string b, 1); M(out int c);
        Console.WriteLine(a + c + b);
        if (TryGet(3, out var d)) Console.WriteLine(d);
        TryGet(4, out _); TryGet(5, out var _); TryGet(6, out int _);
      }
    }`);
  assert.deepEqual(lines, ['2s', '6']);
});

test('SF-A02-T63 a typed out variable or discard must have the type of the parameter (CS1503)', () => {
  assert.deepEqual(errorsOf(inMain('T(out string s);')), ['CS1503 string s']);
  assert.deepEqual(errorsOf(inMain('T(out long _);')), ['CS1503 long _']);
  assert.deepEqual(errorsOf(inMain('S(out object o);')), ['CS1503 object o']);
  assert.deepEqual(errorsOf(inMain('S(out var s); T(out int i); S(out _); Console.WriteLine(s.Length + i);')), []);
});

test('SF-A02-T63 the finder lists the variables a statement adds to its statement list', () => {
  const names = text => statementsOf(text).flatMap(expressionVariableNames);
  assert.deepEqual(names('T(out var a); var b = T(out var c); if (T(out var d)) { T(out var hidden); }'), ['a', 'c', 'd']);
  assert.deepEqual(names('switch (T(out var a) ? 1 : 0) { } lock (T(out var b) ? args : args) { } return;'), ['a', 'b']);
  assert.deepEqual(names('if (args is string[] x && args[0] is var y) { }'), ['x', 'y']);
  // Loops, using and lambdas keep their variables to themselves.
  assert.deepEqual(names('while (T(out var a)) { } do { } while (T(out var b)); for (; T(out var c); ) { }'), []);
  assert.deepEqual(names('Func<bool> f = () => T(out var a); using (T(out var b) ? null : null) { }'), []);
  assert.deepEqual(names('var (p, q) = (1, 2); _ = T(out var _);'), ['p', 'q']);
  // The arms of a switch expression are scopes of their own; its governing expression is not.
  assert.deepEqual(names('var k = (T(out var g) ? 1 : 0) switch { var v when v > 0 => 1, var v => v };'), ['g']);
});

test('SF-A02-T63 variables of loop conditions and the foreach collection do not outlive the loop', () => {
  assert.deepEqual(errorsOf(inMain('while (T(out var w)) { w++; break; } Console.WriteLine(w);')), ['CS0103 w']);
  assert.deepEqual(errorsOf(inMain('do { } while (T(out var d) && d > 5); Console.WriteLine(d);')), ['CS0103 d']);
  assert.deepEqual(errorsOf(inMain('foreach (var x in new int[T(out var n) ? n : 0]) { } Console.WriteLine(n);')), ['CS0103 n']);
  assert.deepEqual(errorsOf(inMain('for (; T(out var c); ) { } Console.WriteLine(c);')), ['CS0103 c']);
  // The same name can be declared by the next loop.
  assert.deepEqual(errorsOf(inMain('while (T(out var w)) { break; } while (T(out var w)) { break; }')), []);
});

test('SF-A02-T63 variables of if, switch, lock and expression statements belong to the enclosing statement list', () => {
  const visible = 'if (T(out var a)) { } switch (T(out var b) ? 1 : 0) { } lock (T(out var c) ? args : args) { } T(out var d);';
  assert.deepEqual(errorsOf(inMain(`${visible} Console.WriteLine(a + b + c + d);`)), []);
  // An embedded statement is its own statement list.
  assert.deepEqual(errorsOf(inMain('if (args.Length > 0) T(out var a); Console.WriteLine(a);')), ['CS0103 a']);
});

test('SF-A02-T63 an expression variable is reserved in its whole scope (CS0841, CS0136, CS0128)', () => {
  assert.deepEqual(errorsOf(inMain('Console.WriteLine(a); T(out var a);')), ['CS0841 a']);
  assert.deepEqual(errorsOf(inMain('{ Console.WriteLine(a); } T(out var a);')), ['CS0841 a']);
  assert.deepEqual(errorsOf(inMain('Func<int> f = () => a; T(out var a); f();')), ['CS0841 a']);
  assert.deepEqual(errorsOf(inMain('{ int a = 1; a++; } T(out var a);')), ['CS0136 a']);
  assert.deepEqual(errorsOf(inMain('T(out var a); { int a = 1; a++; }')), ['CS0136 a']);
  assert.deepEqual(errorsOf(inMain('T(out var a); T(out var a);')), ['CS0128 a']);
});

test('SF-A02-T63 the sections of a switch share one declaration space', () => {
  const source = sections => inMain(`switch (args.Length) { ${sections} }`);
  assert.deepEqual(errorsOf(source('case 0: int e = 1; Console.WriteLine(e); break; case 1: e = 2; Console.WriteLine(e); break;')), []);
  // The second declaration is rejected, so the section reads the first variable, which it does not assign (as Roslyn reports).
  assert.deepEqual(errorsOf(source('case 0: int e = 1; e++; break; case 1: int e = 2; e++; break;')), ['CS0128 e', 'CS0165 e']);
  assert.deepEqual(errorsOf(source('case 0: T(out var h); break; case 1: Console.WriteLine(h); break;')), ['CS0165 h']);
});

test('SF-A02-T63 a variable declared in an operand that is never evaluated is unassigned (CS0165)', () => {
  assert.deepEqual(errorsOf(inMain('bool c = false && T(out var d); Console.WriteLine(d); Console.WriteLine(c);')), ['CS0165 d']);
  assert.deepEqual(errorsOf(inMain('bool c = args.Length > 0 && T(out var d); Console.WriteLine(d); Console.WriteLine(c);')), ['CS0165 d']);
  assert.deepEqual(errorsOf(inMain('if (!T(out var d)) return; Console.WriteLine(d);')), []);
});

test('SF-A02-T63 variables of member and constructor initializers run and stay in their initializer', () => {
  const lines = linesOf(`using System;
    class Program {
      ${helpers}
      static int F = T(out var q) ? q : 0;
      int G = T(out var g) ? g + 1 : 0;
      Program() : this(T(out var c) ? c + 4 : 0) { Console.WriteLine("body sees " + c); }
      Program(int x) { Console.WriteLine("ctor " + x); }
      static void Main() { Console.WriteLine(F + new Program().G); }
    }`);
  assert.deepEqual(lines, ['ctor 5', 'body sees 1', '3']);
  assert.deepEqual(errorsOf(inMain('Console.WriteLine(q);', 'static int F = T(out var q) ? q : 0;')), ['CS0103 q']);
  assert.deepEqual(errorsOf(inMain('', 'Program(int a) : this(T(out var c), c) { int c = 2; c++; } Program(bool b, int x) { }')), ['CS0136 c']);
});

test('SF-A02-T63 expression variables in member initializers and queries need C# 7.3', () => {
  const source = inMain('', 'static int F = T(out var q) ? q : 0;');
  const gate = compile(source, { langVersion: '7.2' }).diagnostics.filter(d => d.code === 'CS8320');
  assert.equal(gate.length, 1);
  assert.equal(source.slice(gate[0].start, gate[0].start + gate[0].length), 'var q');
  assert.deepEqual(compile(source, { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8320'), []);
});

test('SF-A02-T63 discards: assignment, out arguments, and `_` as a variable when one is in scope', () => {
  const lines = linesOf(`using System;
    class Program {
      static int Count;
      static int Next() { return ++Count; }
      static void Two(out int a, out int b) { a = 1; b = 2; }
      static void Main() {
        _ = Next(); Two(out _, out var z); (_, _) = (Next(), Next());
        Console.WriteLine(Count + " " + z);
        WithLocal();
      }
      static void WithLocal() { int _ = 5; _ = 6; Two(out _, out _); Console.WriteLine(_); }
    }`);
  assert.deepEqual(lines, ['3 2', '2']);
  assert.deepEqual(errorsOf(inMain('Console.WriteLine(_);')), ['CS0103 _']);
  assert.deepEqual(errorsOf(inMain('var x = _;')), ['CS0103 _']);
});

test('SF-A02-T63 a discard needs C# 7', () => {
  const source = inMain('_ = args.Length; T(out _);');
  const gates = compile(source, { langVersion: '6' }).diagnostics.filter(d => d.code === 'CS8059' && /'discards'/.test(d.message));
  assert.deepEqual(gates.map(d => source.slice(d.start, d.start + d.length)), ['_', '_']);
  assert.deepEqual(compile(source, { langVersion: '7' }).diagnostics.filter(d => d.code === 'CS8059'), []);
});
