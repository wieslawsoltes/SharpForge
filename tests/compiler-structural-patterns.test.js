import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf } from './support/semantic-codegen.js';

/** A one-line dump of a bound pattern: its kind and what it binds to. */
function dump(pattern) {
  if (!pattern) return 'null';
  const name = pattern.local ? ' ' + pattern.local.type.toDisplayString() + ' ' + pattern.local.name : '';
  switch (pattern.kind) {
    case 'ConstantPattern':
      return `const(${pattern.value.constantValue?.isNull ? 'null' : pattern.value.constantValue?.value})`;
    case 'RelationalPattern':
      return `${pattern.operator} ${pattern.value.constantValue.value}`;
    case 'TypePattern':
    case 'DeclarationPattern':
      return `is ${pattern.testedType.toDisplayString()}${name}`;
    case 'VarPattern':
      return 'var' + name;
    case 'DiscardPattern':
      return '_';
    case 'NotPattern':
      return `not ${dump(pattern.pattern)}`;
    case 'AndPattern':
    case 'OrPattern':
      return `(${dump(pattern.left)} ${pattern.kind === 'AndPattern' ? 'and' : 'or'} ${dump(pattern.right)})`;
    case 'SlicePattern':
      return '..' + (pattern.pattern ? ' ' + dump(pattern.pattern) : '');
    case 'ListPattern':
      return `[${pattern.patterns.map(dump).join(', ')}]${name}`;
    case 'RecursivePattern': {
      const type = pattern.testedType ? pattern.testedType.toDisplayString() : '',
        positional = pattern.positional,
        split = positional ? `${positional.kind === 'method' ? positional.method.toDisplayString() + ':' : ''}(${positional.parts.map(p => dump(p.pattern)).join(', ')})` : '',
        properties = pattern.properties.length ? ` { ${pattern.properties.map(p => p.member.name + ': ' + dump(p.pattern)).join(', ')} }` : '';
      return `${type}${split}${properties}${name}`;
    }
    default:
      return pattern.kind;
  }
}

function patternsOf(body, declarations = '') {
  const source = `using System;\n${declarations}\nclass Program {\n  static void Main(string[] args) {\n    object o = args; int n = args.Length; string s = "s"; int[] a = { 1 }; var t = (1, "x");\n${body}\n  }\n}\n`;
  const analysis = analyze([parse(new SourceText(source, 'Program.cs'))], {});
  const errors = analysis.diagnostics.filter(d => d.severity === 'error');
  assert.deepEqual(
    errors.map(d => d.code + ' ' + d.message),
    [],
  );
  assert.equal(analysis.incomplete, false, 'every pattern is bound in full');
  const found = [];
  for (const bound of analysis.bound.values()) walk(bound, node => void (node.kind === 'IsPattern' && found.push(dump(node.pattern))));
  return found;
}

test('SF-A02-T08.1 bound pattern tree: one snapshot per pattern kind', () => {
  const declarations = 'class Pair { public int A; public void Deconstruct(out int a, out string b) { a = 1; b = "b"; } }\nrecord Point(int X, int Y);';
  const cases = [
    ['n is 5', 'const(5)'],
    ['s is null', 'const(null)'],
    ['o is string text', 'is string string text'],
    ['n is var v', 'var int v'],
    ['n is > 1', '> 1'],
    ['n is not 0', 'not const(0)'],
    ['n is > 0 and < 9 or 100', '((> 0 and < 9) or const(100))'],
    ['s is { Length: 3 }', ' { Length: const(3) }'],
    ['t is (1, var name)', '(const(1), var string name)'],
    ['t is var (x, y)', '(var int x, var string y)'],
    ['new Pair() is (2, _) { A: 0 } p', 'Pair.Deconstruct(out int, out string):(const(2), _) { A: const(0) } Pair p'],
    ['new Point(1, 2) is Point(var px, > 1)', 'PointPoint.Deconstruct(out int, out int):(var int px, > 1)'],
    ['a is [1, .., var last]', '[const(1), .., var int last]'],
    ['a is [.. var rest] whole', '[.. var int[] rest] int[] whole'],
    ['a is []', '[]'],
  ];
  const body = cases.map(([text], index) => `    bool b${index} = ${text};`).join('\n') + '\n    Console.WriteLine(n);';
  assert.deepEqual(
    patternsOf(body, declarations),
    cases.map(([, expected]) => expected),
  );
});

test('SF-A02-T08.1/2 corpus: positional and list pattern fixtures match Roslyn and .NET on both back ends', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.id.startsWith('pattern-lowering/') && /positional|list/.test(f.id));
  assert.ok(fixtures.length >= 3);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T08.2 Deconstruct runs once per decision; array elements are read once', () => {
  const lines = linesOf(`
    using System;
    class Source {
      public static int Calls;
      public void Deconstruct(out int a, out int b) { Calls++; a = 3; b = 4; }
    }
    class Program {
      static int reads;
      static int[] Data() { reads++; return new[] { 1, 2, 3 }; }
      static void Main() {
        var text = new Source() switch { (1, _) => "a", (_, 1) => "b", (3, 5) => "c", (3, 4) => "d", _ => "e" };
        Console.WriteLine(text + Source.Calls);
        Console.WriteLine(Data() switch { [2, ..] => "x", [1, 9, ..] => "y", [1, .., 3] => "z", _ => "w" });
        Console.WriteLine(reads);
      }
    }`);
  assert.deepEqual(lines, ['d1', 'z', '1']);
});
