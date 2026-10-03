// SF-A02-T10.4: init accessors (CS8852, CS8856) and required members (CS9035 and friends) against Roslyn and .NET.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { requiredMembersOf, setsRequiredMembers } from '../packages/compiler/src/binder/members/required-members.js';
import { testPinnedFeature } from './support/pinned-feature.js';

testPinnedFeature('SF-A02-T10.4', 'member-init', { outputs: 1, diagnostics: 4 });
testPinnedFeature('SF-A02-T10.4', 'member-required', {
  outputs: 1,
  diagnostics: 6,
  knownGaps: {
    'member-required/required-language-version': 'the parser reports the gate on the `required` keyword; Roslyn reports it on the member name',
  },
});

const analysisOf = source => analyze([parse(new SourceText(source, 'a.cs'))]);
const errorsOf = source =>
  analysisOf(source)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`)
    .sort();

test('SF-A02-T10.4 required members are collected from the type and its base classes', () => {
  const analysis = analysisOf(`
    class Base { public required int A { get; set; } public int Free; }
    class Derived : Base { public required string B; public static int S; }
    class P { static void Main() { } }`);
  const derived = analysis.assembly.types.find(type => type.name === 'Derived');
  assert.deepEqual(
    requiredMembersOf(derived, analysis.core).map(member => member.name),
    ['B', 'A'],
  );
});

test('SF-A02-T10.4 a derived creation must set the required members of its base', () => {
  const source = `
    class Base { public required int A { get; set; } }
    class Derived : Base { public required string B; }
    class P { static void Main() { var d = new Derived { B = "b" }; var e = new Derived { A = 1, B = "b" }; } }`;
  assert.deepEqual(errorsOf(source), ['CS9035:Derived']);
});

test('SF-A02-T10.4 [SetsRequiredMembers] is read from the constructor declaration, with or without the suffix', () => {
  const analysis = analysisOf(`
    class P {
      public required int X { get; set; }
      public P() { }
      [System.Diagnostics.CodeAnalysis.SetsRequiredMembers] public P(int x) { X = x; }
      [SetsRequiredMembersAttribute] public P(string s) { }
    }
    class Q { static void Main() { } }`);
  const constructors = analysis.assembly.types.find(type => type.name === 'P').getMembers('.ctor');
  assert.deepEqual(
    constructors.map(constructor => [constructor.parameters.length, setsRequiredMembers(constructor)]),
    [
      [0, false],
      [1, true],
      [1, true],
    ],
  );
});

test('SF-A02-T10.4 an init-only property is assignable in initializers, constructors and init accessors only', () => {
  const source = `
    class P {
      public int X { get; init; }
      public int Y { get { return 0; } init { X = value; } }
      public P() { X = 1; }
      void M() { X = 2; }
    }
    class Q { static void Main() { var p = new P { X = 3, Y = 4 }; p.X = 5; } }`;
  assert.deepEqual(errorsOf(source), ['CS8852:X', 'CS8852:p.X']);
});

test('SF-A02-T10.4 compile() reports the C# diagnostics of an invalid init program, without the adapter stand-in', () => {
  const result = compile(`class P { public static int S { get; init; } } class Q { static void Main() { } }`);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code),
    ['CS8856'],
  );
});
