import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { analyzeCaptures } from '../packages/compiler/src/lowering/closures.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

function analysisOf(source) {
  const file = parse(new SourceText(source, 'Program.cs'));
  return analyze([file], {});
}
function nodesOf(analysis, kind) {
  const found = [];
  for (const body of analysis.bound.values()) walk(body, node => void (node.kind === kind && found.push(node)));
  return found;
}
function corpusPasses(feature, minimum) {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === feature);
  assert.ok(fixtures.length >= minimum);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
}

test('SF-A02-T08.5 corpus: every deconstruction fixture matches Roslyn and .NET on both back ends', () => corpusPasses('deconstruction', 6));

test('SF-A02-T04.2 corpus: by-reference parameters match .NET on both back ends', () => corpusPasses('by-reference', 2));

test('SF-A02-T08.5 the plan mirrors the targets: literal, tuple and Deconstruct splits with a conversion per part', () => {
  const analysis = analysisOf(`
    class Pair { public void Deconstruct(out int a, out string b) { a = 1; b = "b"; } }
    class Program {
      static (int, int) Two() { return (1, 2); }
      static void Main() {
        double d; object o;
        (d, (o, _)) = (1, new Pair());
        var (x, y) = Two();
        System.Console.WriteLine(d + x + y);
        System.Console.WriteLine(o);
      }
    }`);
  assert.deepEqual(
    analysis.diagnostics.filter(d => d.severity === 'error'),
    [],
  );
  assert.equal(analysis.incomplete, false);
  const [first, second] = nodesOf(analysis, 'DeconstructionAssignment');
  assert.equal(first.plan.kind, 'literal');
  assert.equal(first.plan.parts[0].conversion.kind, 'ImplicitNumeric');
  const byMethod = first.plan.parts[1];
  assert.equal(byMethod.kind, 'method');
  assert.equal(byMethod.method.name, 'Deconstruct');
  assert.equal(byMethod.parts[0].conversion.kind, 'Boxing');
  assert.equal(byMethod.parts[1].target.kind, 'Discard');
  assert.equal(second.plan.kind, 'tuple');
  assert.deepEqual(
    second.left.elements.map(element => element.local.type.toDisplayString()),
    ['int', 'int'],
    'var variables take the type of their part',
  );
});

test('SF-A02-T08.5 a Deconstruct call runs once and a discarded part is still evaluated', () => {
  const lines = linesOf(`
    using System;
    class Source {
      public static int Calls;
      public void Deconstruct(out int a, out int b) { Calls++; a = 1; b = 2; }
    }
    class Program {
      static int Noisy(int n) { Console.WriteLine("eval " + n); return n; }
      static void Main() {
        var (a, _) = new Source();
        (_, var b) = (Noisy(1), Noisy(2));
        Console.WriteLine(a + b + Source.Calls);
      }
    }`);
  assert.deepEqual(lines, ['eval 1', 'eval 2', '4']);
});

test('SF-A02-T04.2 a variable passed by reference lives in a cell; other variables keep their slots', () => {
  const analysis = analysisOf(`
    class Program {
      static void Set(out int value, ref int other, in int read) { value = other + read; }
      static void Main() {
        int a = 1, b = 2, c = 3;
        Set(out int d, ref a, in b);
        System.Console.WriteLine(a + b + c + d);
      }
    }`);
  const main = [...analysis.bound].find(([symbol]) => symbol.name === 'Main')[1];
  const cells = [...analyzeCaptures(main).captured].map(symbol => symbol.name).sort();
  assert.deepEqual(cells, ['a', 'b', 'd']);
});

test('SF-A02-T04.2 what cannot share a cell is reported, not copied', () => {
  const field = notExecutable(`
    class Box { public int Value; }
    class Program {
      static void Bump(ref int value) { value++; }
      static void Main() { var box = new Box(); Bump(ref box.Value); System.Console.WriteLine(box.Value); }
    }`);
  assert.match(field.message, /passing a field or an array element by reference/);
});
