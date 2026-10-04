/**
 * Breaking-change regression corpus (SF-A02-T12.1): one entry per documented C# breaking change whose behaviour
 * depends on the selected language version. Each entry is one source compiled at the last version with the old
 * behaviour and at the first version with the new one; both results are pinned against Roslyn through the
 * differential corpus (../../differential/fixtures/breaking-changes.js), so the old and the new behaviour are each
 * asserted under their own version.
 *
 * `kind` says what Roslyn does at that version: 'output' (compiles, the program output is pinned) or 'diagnostics'
 * (errors or warnings are pinned). `sameInRoslyn` marks a change the pinned Roslyn does not make depend on the
 * language version: the fixtures then pin that both versions behave alike.
 */
const cs = lines => lines.join('\n') + '\n';
const docs = 'https://learn.microsoft.com/dotnet/csharp/';
const breaks = docs + 'whats-new/breaking-changes/compiler%20breaking%20changes%20-%20';

export const breakingChanges = Object.freeze([
  {
    id: 'foreach-capture',
    title: 'C# 5: each iteration of foreach has its own loop variable for closures',
    reference: docs + 'language-reference/statements/iteration-statements#the-foreach-statement',
    sameInRoslyn: true,
    old: { langVersion: '4', kind: 'output' },
    new: { langVersion: '5', kind: 'output' },
    source: cs([
      'using System;',
      'using System.Collections.Generic;',
      'class Program',
      '{',
      '    static void Main()',
      '    {',
      '        var actions = new List<Func<int>>();',
      '        foreach (var i in new int[] { 1, 2, 3 }) actions.Add(delegate { return i; });',
      '        foreach (var action in actions) Console.WriteLine(action());',
      '    }',
      '}',
    ]),
  },
  {
    id: 'inferred-tuple-names',
    title: 'C# 7.1: tuple element names are inferred from the element expressions',
    reference: docs + 'language-reference/builtin-types/value-tuples#tuple-field-names',
    old: { langVersion: '7', kind: 'diagnostics' },
    new: { langVersion: '7.1', kind: 'output' },
    source: cs(['using System;', 'class Program { static void Main() { int a = 1, b = 2; var t = (a, b); Console.WriteLine(t.a); } }']),
  },
  {
    id: 'target-typed-conditional',
    title: 'C# 9: a conditional expression without a natural type is target-typed',
    reference: docs + 'language-reference/proposals/csharp-9.0/target-typed-conditional-expression',
    old: { langVersion: '8', kind: 'diagnostics' },
    new: { langVersion: '9', kind: 'output' },
    source: cs(['using System;', 'class Program { static void Main() { bool b = true; int? x = b ? 1 : null; Console.WriteLine(x); } }']),
  },
  {
    id: 'record-type-name',
    title: "C# 9: 'record' is a contextual keyword; a type named record is reported",
    reference: breaks + 'dotnet%205',
    old: { langVersion: '8', kind: 'output' },
    new: { langVersion: '9', kind: 'output' },
    source: cs(['using System;', 'class record { public int V = 1; }', 'class Program { static void Main() { Console.WriteLine(new record().V); } }']),
  },
  {
    id: 'required-scoped-file-type-names',
    title: "C# 11: types cannot be named 'required', 'scoped' or 'file'",
    reference: breaks + 'dotnet%207',
    old: { langVersion: '10', kind: 'output' },
    new: { langVersion: '11', kind: 'diagnostics' },
    source: cs([
      'using System;',
      'class required { public int V = 1; }',
      'class scoped { public int V = 2; }',
      'class file { public int V = 3; }',
      'class Program { static void Main() { Console.WriteLine(new required().V + new scoped().V + new file().V); } }',
    ]),
  },
  {
    id: 'extension-type-name',
    title: "C# 14: types cannot be named 'extension'",
    reference: breaks + 'dotnet%2010',
    old: { langVersion: '13', kind: 'output' },
    new: { langVersion: '14', kind: 'diagnostics' },
    source: cs(['using System;', 'class extension { public int V = 1; }', 'class Program { static void Main() { Console.WriteLine(new extension().V); } }']),
  },
  {
    id: 'field-keyword',
    title: "C# 14: 'field' in a property accessor is the synthesized backing field, not a member named field",
    reference: breaks + 'dotnet%2010',
    old: { langVersion: '13', kind: 'output' },
    new: { langVersion: '14', kind: 'output' },
    source: cs([
      'using System;',
      'class C { int field = 5; public int P { get { return field; } set { field = value; } } }',
      'class Program { static void Main() { var c = new C(); Console.WriteLine(c.P); c.P = 7; Console.WriteLine(c.P); } }',
    ]),
  },
]);

const sideName = (change, side) => `${change.id}-csharp-${change[side].langVersion.replace('.', '-')}`;

/** The differential fixture id of one side (`'old'` or `'new'`) of a change. */
export const fixtureIdOf = (change, side) => 'breaking-changes/' + sideName(change, side);

/** The two differential fixtures of every change, without the feature tag (../../differential/fixtures/breaking-changes.js adds it). */
export function breakingChangeFixtures() {
  return breakingChanges.flatMap(change =>
    ['old', 'new'].map(side => ({ id: sideName(change, side), kind: change[side].kind, langVersion: change[side].langVersion, source: change.source })),
  );
}
