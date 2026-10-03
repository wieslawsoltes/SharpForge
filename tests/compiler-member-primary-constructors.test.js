// SF-A02-T10.5: primary constructors - scope, capture into the type, initialization order and diagnostics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { testPinnedFeature } from './support/pinned-feature.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

testPinnedFeature('SF-A02-T10.5', 'member-primary-constructors', { outputs: 3, diagnostics: 6 });

const analysisOf = source => analyze([parse(new SourceText(source, 'a.cs'))]);

test('SF-A02-T10.5 only parameters an instance member names are captured; a member of the same name wins', () => {
  const analysis = analysisOf(`
    class C(int a, int b, int c) {
      int f = a;
      int c = c;
      public int B => b;
      public int Sum => f + c;
    }
    class P { static void Main() { var x = new C(1, 2, 3); } }`);
  assert.deepEqual(
    analysis.diagnostics.filter(d => d.severity === 'error').map(d => d.code),
    [],
  );
  const parameters = analysis.assembly.types.find(type => type.name === 'C').primaryConstructor.parameters;
  assert.deepEqual(
    parameters.map(parameter => [parameter.name, !!parameter.capturedByType, !!parameter.readByInitializer]),
    [
      ['a', false, true],
      ['b', true, false],
      ['c', false, true],
    ],
  );
});

test('SF-A02-T10.5 a captured parameter is one field of the image class, named as Roslyn names it', () => {
  const result = compile(`
    using System;
    class C(int a, int b) { int f = a; public int B => b; public int F => f; }
    class Program { static void Main() { var c = new C(1, 2); Console.WriteLine(c.B + c.F); } }`);
  assert.equal(result.success, true, result.diagnostics.map(d => d.message).join('; '));
  const image = result.image.types.find(type => type.name === 'C');
  assert.deepEqual(
    image.fields.map(field => field.name),
    ['f', '<b>P'],
  );
});

test('SF-A02-T10.5 each object has its own captured state, also seen by lambdas and iterators of its members', () => {
  const lines = linesOf(`
    using System;
    using System.Collections.Generic;
    class Range(int from, int count) {
      public IEnumerable<int> Values() { for (int i = 0; i < count; i++) yield return from + i; }
      public Func<int> Last() { return () => from + count - 1; }
      public void Shift(int by) { from += by; }
    }
    class Program {
      static void Main() {
        var a = new Range(1, 3);
        var b = new Range(10, 2);
        a.Shift(5);
        foreach (var v in a.Values()) Console.WriteLine(v);
        Console.WriteLine(a.Last()() + " " + b.Last()());
      }
    }`);
  assert.deepEqual(lines, ['6', '7', '8', '8 11']);
});

test('SF-A02-T10.5 a primary constructor with base arguments is named as not executable (no inheritance in the runtime)', () => {
  const diagnostic = notExecutable(`
    class B(int x) { public int X => x; }
    class D(int y) : B(y) { }
    class Program { static void Main() { var d = new D(1); } }`);
  assert.match(diagnostic.message, /class inheritance|base constructor/);
});
