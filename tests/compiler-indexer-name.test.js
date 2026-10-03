import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { indexerNameOf, accessorBaseName } from '../packages/compiler/src/binder/members/indexer-names.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const header = 'using System;\nusing System.Runtime.CompilerServices;\n';

function analysisOf(source) {
  return analyze([parse(new SourceText(header + source, 'Program.cs'))], {});
}
const typeNamed = (analysis, name) => analysis.assembly.types.find(type => type.name === name);
const indexersOf = type => type.getMembers().filter(member => member.isIndexer);
const codesOf = analysis => analysis.diagnostics.filter(d => d.severity === 'error' && d.code !== 'CS5001').map(d => d.code);

test('SF-A02-T10.2 corpus: the IndexerName fixtures match Roslyn; an interface indexer read is recorded as not executable', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'indexer-name');
  assert.ok(fixtures.length >= 8);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    if (fixture.id === 'indexer-name/interface-indexer-names') {
      assert.equal(row.passed, false);
      assert.match(JSON.stringify(row.details), /SF2200/);
    } else assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T10.2 an indexer is named Item; the attribute renames it and its accessors', () => {
  const analysis = analysisOf(`
class Plain { public int this[int i] { get { return i; } set { } } }
class Named {
  [IndexerName("Cell")] public int this[int i] { get { return i; } set { } }
  [IndexerName("Cell")] public int this[string s] { get { return 0; } }
  public int Size { get { return 1; } }
}`);
  assert.deepEqual(codesOf(analysis), []);
  const [plain] = indexersOf(typeNamed(analysis, 'Plain')),
    named = typeNamed(analysis, 'Named'),
    [first, second] = indexersOf(named);
  assert.equal(indexerNameOf(plain), 'Item');
  assert.deepEqual([plain.getMethod.name, plain.setMethod.name], ['get_Item', 'set_Item']);
  assert.equal(indexerNameOf(first), 'Cell');
  assert.equal(indexerNameOf(second), 'Cell');
  assert.deepEqual([first.getMethod.name, first.setMethod.name, second.getMethod.name], ['get_Cell', 'set_Cell', 'get_Cell']);
  // The symbol is still found as an indexer; only its metadata name changed.
  assert.equal(first.name, 'this[]');
  assert.equal(accessorBaseName(first), 'Cell');
  assert.equal(accessorBaseName(named.getMembers('Size')[0]), 'Size');
});

test('SF-A02-T10.2 an override takes the name of the indexer it overrides, across more than one level', () => {
  const analysis = analysisOf(`
class Leaf : Middle { public override int this[int i] { get { return 2; } } }
class Middle : Root { [IndexerName("Ignored")] public override int this[int i] { get { return 1; } } }
class Root { [IndexerName("Cell")] public virtual int this[int i] { get { return 0; } } }`);
  assert.deepEqual(codesOf(analysis), []);
  for (const name of ['Root', 'Middle', 'Leaf']) {
    const [indexer] = indexersOf(typeNamed(analysis, name));
    assert.equal(indexerNameOf(indexer), 'Cell', name);
    assert.equal(indexer.getMethod.name, 'get_Cell', name);
  }
});

test('SF-A02-T10.2 name rules: CS0633 for a non-identifier, CS0668 for differing names, CS0415 off an indexer', () => {
  const invalid = text => codesOf(analysisOf(`class C { [IndexerName(${text})] public int this[int i] { get { return i; } } }`));
  for (const text of ['"a b"', '""', 'null', '"@x"', '"1x"', '"a-b"']) assert.deepEqual(invalid(text), ['CS0633'], text);
  for (const text of ['"x"', '"_x1"', '"class"', '"été"', '"a" + "b"']) assert.deepEqual(invalid(text), [], text);
  // A rejected name leaves the indexer named Item.
  const rejected = analysisOf('class C { [IndexerName("a b")] public int this[int i] { get { return i; } } }');
  assert.equal(indexerNameOf(indexersOf(typeNamed(rejected, 'C'))[0]), 'Item');
  assert.deepEqual(
    codesOf(analysisOf('class C { [IndexerName("A")] public int this[int i] { get { return i; } } public int this[long l] { get { return 0; } } }')),
    ['CS0668'],
  );
  assert.deepEqual(codesOf(analysisOf('class C { [IndexerName("A")] public int P { get { return 1; } } }')), ['CS0415']);
});

test('SF-A02-T10.2 the name is reserved in the type: CS0102 for members and type parameters, CS0082 for accessor look-alikes', () => {
  const conflict = body => codesOf(analysisOf(`class C<T> { [IndexerName("Cell")] public int this[int i] { get { return i; } set { } } ${body} }`));
  assert.deepEqual(conflict('public void Cell() { }'), ['CS0102']);
  assert.deepEqual(conflict('public int Cell { get { return 1; } }'), ['CS0102']);
  assert.deepEqual(conflict('class Cell { }'), ['CS0102']);
  assert.deepEqual(codesOf(analysisOf('class C<Cell> { [IndexerName("Cell")] public int this[int i] { get { return i; } } }')), ['CS0102']);
  // A method named like an accessor conflicts only with the same parameter types.
  assert.deepEqual(conflict('public int get_Cell(int i) { return i; }'), ['CS0082']);
  assert.deepEqual(conflict('public int get_Cell(long i) { return 0; }'), []);
  assert.deepEqual(conflict('public void set_Cell(int i, int v) { }'), ['CS0082']);
  assert.deepEqual(conflict('public void set_Cell(int i) { }'), []);
  assert.deepEqual(conflict('public int Item; public int get_Item(int i) { return i; }').filter(code => code !== 'CS0649'), []);
});

test('SF-A02-T10.2 execution: a renamed indexer reads, writes and compound-assigns on both back ends', () => {
  const lines = linesOf(`${header}
class Grid {
  int[] data = new int[4];
  [IndexerName("Cell")] public int this[int i] { get { return data[i]; } set { data[i] = value; } }
  public int get_Item(int i) { return -i; }
}
class Program {
  static void Main() {
    var g = new Grid();
    g[2] = 3;
    g[2] *= 5;
    g[1]++;
    Console.WriteLine(g[2] + " " + g[1] + " " + g.get_Item(4));
  }
}`);
  assert.deepEqual(lines, ['15 1 -4']);
});

test('SF-A02-T10.2 unsupported: an indexer read through an interface value is SF2200, not a wrong result', () => {
  const reported = notExecutable(`${header}
interface IRow { [IndexerName("Row")] string this[int i] { get; } }
class Table : IRow { public string this[int i] { get { return "r" + i; } } }
class Program { static void Main() { IRow row = new Table(); Console.WriteLine(row[2]); } }`);
  assert.match(reported.message, /interface/);
});
