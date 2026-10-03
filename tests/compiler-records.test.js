import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { RecordMember, positionalProperties } from '../packages/compiler/src/symbols/synthesized/records.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable, runOnBothBackEnds } from './support/semantic-codegen.js';

function analysisOf(source) {
  const file = parse(new SourceText(source, 'Program.cs'));
  return analyze([file], {});
}
const recordNamed = (analysis, name) => analysis.assembly.types.find(type => type.name === name);

test('SF-A02-T08.6/7 corpus: every record fixture matches Roslyn and .NET on both back ends', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'record-lowering');
  assert.ok(fixtures.length >= 6);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T08.6 a record gets the synthesized members it does not declare', () => {
  const analysis = analysisOf(`
    record Point(int X, int Y);
    record Custom(int A) {
      public override string ToString() { return "c"; }
      public void Deconstruct(out int a) { a = A; }
    }
    record Plain { public int N { get; init; } }
    class P { static void Main() { } }`);
  const kinds = type =>
    type
      .getMembers()
      .filter(member => member.recordMember)
      .map(member => member.recordMember)
      .sort();
  const all = Object.values(RecordMember).sort();
  assert.deepEqual(kinds(recordNamed(analysis, 'Point')), all);
  assert.deepEqual(
    kinds(recordNamed(analysis, 'Custom')),
    all.filter(kind => kind !== RecordMember.ToString && kind !== RecordMember.Deconstruct),
  );
  assert.deepEqual(
    kinds(recordNamed(analysis, 'Plain')),
    all.filter(kind => kind !== RecordMember.Deconstruct),
    'no Deconstruct without positional parameters',
  );
  const point = recordNamed(analysis, 'Point');
  assert.deepEqual(
    positionalProperties(point).map(property => property.name),
    ['X', 'Y'],
  );
  const deconstruct = point.getMembers('Deconstruct')[0];
  assert.deepEqual(
    deconstruct.parameters.map(parameter => `${parameter.refKind} ${parameter.type.toDisplayString()} ${parameter.name}`),
    ['out int X', 'out int Y'],
  );
  assert.equal(point.getMembers('op_Equality')[0].isStatic, true);
});

test('SF-A02-T08.6 record operators and members bind to the synthesized symbols', () => {
  const analysis = analysisOf(`
    record Point(int X, int Y);
    class P { static void Main() { var p = new Point(1, 2); var q = new Point(1, 2); System.Console.WriteLine(p == q); System.Console.WriteLine(p.Equals(q)); } }`);
  assert.deepEqual(analysis.diagnostics, []);
  assert.equal(analysis.incomplete, false);
  const bound = [];
  for (const body of analysis.bound.values()) walk(body, node => void ((node.kind === 'Binary' || node.kind === 'Call') && bound.push(node)));
  assert.equal(bound.find(node => node.kind === 'Binary').method.recordMember, RecordMember.Equality);
  assert.ok(bound.some(node => node.kind === 'Call' && node.method.recordMember === RecordMember.Equals));
});

test('SF-A02-T08.6 synthesized members are built only when something uses them', () => {
  const source = body => `
    using System;
    class Opaque { }
    record Wrapper(Opaque Value, string Name);
    class Program { static void Main() { var w = new Wrapper(new Opaque(), "n"); ${body} } }`;
  const { image } = runOnBothBackEnds(source('Console.WriteLine(w.Name); Console.WriteLine(w == w with { });'));
  const methods = image.methods.filter(method => method.owner === 'Wrapper').map(method => method.name);
  assert.ok(methods.includes('op_Equality') && methods.includes('<Clone>$'));
  assert.ok(!methods.includes('ToString'), 'ToString was never asked for');
  // The text of an Opaque member would need a virtual ToString: reported only when the record's text is used.
  const reported = notExecutable(source('Console.WriteLine(w);'));
  assert.match(reported.message, /text of a member of type 'Opaque'/);
  const boxed = notExecutable(source('object o = w; Console.WriteLine(o);'));
  assert.match(boxed.message, /converting 'Wrapper' to 'object'/);
});

test('SF-A02-T08.7 with: the receiver is evaluated once, the copy is a new object, init-only members are assignable', () => {
  const lines = linesOf(`
    using System;
    record Box(int Size) { public string Label { get; init; } }
    class Program {
      static int calls;
      static Box Get(Box b) { calls++; return b; }
      static void Main() {
        var a = new Box(1) { Label = "a" };
        var b = Get(a) with { Size = 2, Label = "b" };
        Console.WriteLine(a);
        Console.WriteLine(b);
        Console.WriteLine(calls);
        Console.WriteLine((a with { }) == a);
      }
    }`);
  assert.deepEqual(lines, ['Box { Size = 1, Label = a }', 'Box { Size = 2, Label = b }', '1', 'True']);
});

test('SF-A02-T08.6 a record struct binds like a record but is not executable: the image has no value types', () => {
  const source = 'record struct Size(int W, int H);\nclass P { static void Main() { var s = new Size(1, 2); var (w, h) = s; System.Console.WriteLine(w + h); } }';
  const analysis = analysisOf(source);
  assert.deepEqual(analysis.diagnostics, []);
  assert.equal(analysis.incomplete, false);
  assert.match(notExecutable(source).message, /struct types/);
});
