// SF-A02-T10.2 (indexers), SF-A02-T06.5 (operators) and SF-A02-T06.4 (conversions): declaration rules, binding and
// execution through the semantic code generator, compared with Roslyn and .NET.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { testPinnedFeature } from './support/pinned-feature.js';
import { linesOf } from './support/semantic-codegen.js';

testPinnedFeature('SF-A02-T10.2', 'member-indexers', { outputs: 4, diagnostics: 2 });
testPinnedFeature('SF-A02-T06.5', 'member-operators', { outputs: 5, diagnostics: 5 });

function analysisOf(source) {
  return analyze([parse(new SourceText(source, 'a.cs'))]);
}
const errorsOf = source =>
  analysisOf(source)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`)
    .sort();
function nodesOf(source, kind) {
  const analysis = analysisOf(source),
    found = [];
  assert.deepEqual(errorsOf(source), []);
  for (const body of analysis.bound.values()) walk(body, node => (node.kind === kind ? found.push(node) : true));
  return found;
}

const meters = `
  class Meters {
    public double Value;
    public static implicit operator double(Meters m) => m.Value;
    public static implicit operator string(Meters m) => "m";
    public static implicit operator bool(Meters m) => m.Value != 0;
  }`;

test('SF-A02-T06.5 predefined operators are candidates for operands with user-defined implicit conversions', () => {
  const source = `${meters}
    class P { static void Main() { var m = new Meters(); var a = m + 1.5; var b = m + "x"; var c = -m; var d = !m; var e = m < 2; var f = m == 1.0; } }`;
  const types = nodesOf(source, 'Binary').map(node => `${node.operator} ${node.type.toDisplayString()}`);
  assert.deepEqual(types.slice(-4), ['+ double', '+ string', '< bool', '== bool']);
  assert.deepEqual(
    nodesOf(source, 'Unary').map(node => `${node.operator} ${node.type.toDisplayString()}`),
    ['- double', '! bool'],
  );
});

test('SF-A02-T06.5 without an applicable predefined signature the operator is still CS0019 / CS0023', () => {
  const source = `${meters}
    class Other { }
    class P { static void Main() { var m = new Meters(); var o = new Other(); var a = m - o; var b = ~m; } }`;
  assert.deepEqual(errorsOf(source), ['CS0019:m - o', 'CS0023:~m']);
});

test('SF-A02-T06.5 a user-defined && or || carries its operator true/false', () => {
  const [node] = nodesOf(
    `class T {
       public static bool operator true(T t) => true;
       public static bool operator false(T t) => false;
       public static T operator &(T a, T b) => a;
     }
     class P { static void Main() { var t = new T(); var r = t && t; } }`,
    'Binary',
  );
  assert.equal(node.isLogical, true);
  assert.equal(node.method.name, 'op_BitwiseAnd');
  assert.equal(node.shortCircuit.name, 'op_False');
});

test('SF-A02-T10.2 an indexer is resolved over its own parameters: optional, named and params', () => {
  const accesses = nodesOf(
    `class Table {
       public int this[int row, int column = 7] { get { return row * column; } set { } }
       public int this[string key, params int[] rest] { get { return rest.Length; } }
     }
     class P { static void Main() { var t = new Table(); int a = t[1]; int b = t[column: 2, row: 3]; int c = t["k", 1, 2]; t[4] = 5; } }`,
    'IndexerAccess',
  );
  assert.deepEqual(
    accesses.map(node => [node.property.parameters.length, node.args.length, !!node.expanded]),
    [
      [2, 1, false],
      [2, 2, false],
      [2, 3, true],
      [2, 1, false],
    ],
  );
  assert.deepEqual(accesses[1].mapping.parameterOf, [1, 0]);
});

test('SF-A02-T10.2 the operands of an indexer store are evaluated before the value, once', () => {
  const lines = linesOf(`
    using System;
    class Row {
      int[] cells = new int[4];
      public int this[int i] { get { Console.WriteLine("get " + i); return cells[i]; } set { Console.WriteLine("set " + i + "=" + value); cells[i] = value; } }
    }
    class Program {
      static Row row = new Row();
      static Row Get() { Console.WriteLine("row"); return row; }
      static int Index(int i) { Console.WriteLine("index " + i); return i; }
      static int Value(int v) { Console.WriteLine("value " + v); return v; }
      static void Main() {
        Get()[Index(1)] = Value(5);
        Get()[Index(1)] += Value(2);
        Console.WriteLine(Get()[Index(1)]++);
      }
    }`);
  assert.deepEqual(lines, [
    'row', 'index 1', 'value 5', 'set 1=5',
    'row', 'index 1', 'get 1', 'value 2', 'set 1=7',
    'row', 'index 1', 'get 1', 'set 1=8', '7',
  ]);
});

test('SF-A02-T06.5 operator declaration rules that the pinned fixture does not reach', () => {
  const source = `
    interface I { }
    class V {
      public static V operator -(int a) { return null; }
      public static int operator true(V a) { return 0; }
      public static int operator false(V a) { return 0; }
      public static V operator ++(int a) { return null; }
      public static implicit operator int(string s) { return 0; }
      public static implicit operator I(V v) { return null; }
      public static V operator !(V a, V b) { return a; }
    }
    class P { static void Main() { } }`;
  const codes = analysisOf(source)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => d.code)
    .sort();
  assert.deepEqual(codes, ['CS0215', 'CS0215', 'CS0552', 'CS0556', 'CS0559', 'CS0562', 'CS1535']);
});
