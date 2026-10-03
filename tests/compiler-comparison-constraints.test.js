import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { coreTypes } from '../packages/compiler/src/symbols/core-types.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';
import { testPinnedFeature } from './support/pinned-feature.js';

// SF-A02-T02: `where T : IComparable<T>` and `where T : IEquatable<T>` over simple types. The pinned fixtures print on
// both back ends what the same programs print on .NET (Roslyn 5.3.0, .NET 10).
testPinnedFeature('SF-A02-T02', 'comparison-constraints', { outputs: 1, diagnostics: 2 });

const generics = `
  static T Max<T>(T a, T b) where T : IComparable<T> { return a.CompareTo(b) > 0 ? a : b; }
  static bool Same<T>(T a, T b) where T : IEquatable<T> { return a.Equals(b); }
  static int Hash<T>(T a) { return a.GetHashCode(); }
  static bool Equal<T>(T a, T b) { return a.Equals(b); }
  static int Loose<T>(T a, object b) where T : IComparable { return a.CompareTo(b); }`;
const program = body => `using System;\nclass Animal { }\nclass Program { ${generics}\n static void Main() { ${body} } }\n`;

test('A02-T02 the simple types implement the comparison interfaces of themselves', () => {
  const core = coreTypes();
  for (const keyword of ['int', 'double', 'bool', 'string', 'char', 'long', 'decimal']) {
    const type = core[keyword],
      names = type.interfaces.map(candidate => candidate.toDisplayString());
    assert.deepEqual(names, ['System.IComparable', `System.IComparable<${keyword}>`, `System.IEquatable<${keyword}>`], keyword);
    const members = name => type.getMembers(name).filter(member => member.primitiveMember);
    assert.deepEqual(members('CompareTo').map(member => member.parameters[0].type.toDisplayString()).sort(), [keyword, 'object'].sort(), keyword);
    assert.deepEqual(
      members('Equals').map(member => member.parameters[0].type.toDisplayString()),
      [keyword],
      keyword,
    );
  }
  assert.equal(core.icomparableT.typeParameters[0].variance, 'in');
  assert.equal(core.object.interfaces.length, 0);
});

test('A02-T02 comparison members of int, double and bool are expanded and evaluate each operand once', () => {
  const lines = linesOf(
    program(
      `int calls = 0; int Next() { calls++; return calls * 10; }
       Console.WriteLine(Max(Next(), Next()) + " " + calls);
       Console.WriteLine(Next().CompareTo(Next()) + " " + Next().Equals(Next()) + " " + calls);
       Console.WriteLine(Max(1.5, 0.5) + " " + Max(true, false) + " " + Same(2, 2) + " " + Same("a", "b"));`,
    ),
  );
  assert.deepEqual(lines, ['20 2', '-1 False 6', '1.5 True True False']);
});

test('A02-T02 a comparison member the registry cannot run is refused with the missing contract named', () => {
  const cases = [
    ['Console.WriteLine(Max("pear", "apple"));', /'string\.CompareTo\(string\)' \(not in the framework registry\)/],
    ['Console.WriteLine("a".CompareTo("b"));', /'string\.CompareTo\(string\)' \(not in the framework registry\)/],
    ['Console.WriteLine(Hash(5));', /'object\.GetHashCode\(\)' \(not in the framework registry\)/],
    ['Console.WriteLine(Equal(5, 5));', /'object\.Equals\(object\)' \(not in the framework registry\)/],
    ['Console.WriteLine(Loose(5, 6));', /'int\.CompareTo\(object\)' \(not in the framework registry\)/],
    ['IComparable<int> c = 5; Console.WriteLine(c.CompareTo(4));', /type 'System\.IComparable<int>' \(not in the framework registry\)/],
  ];
  for (const [body, expected] of cases) assert.match(notExecutable(program(body)).message, expected, body);
});

test('A02-T02 a type that does not implement the constraint interface is rejected as Roslyn rejects it', () => {
  const codes = body =>
    compile(program(body))
      .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
      .map(d => d.code);
  assert.deepEqual(codes('Max(new Animal(), new Animal());'), ['CS0311']);
  assert.deepEqual(codes('Same<Animal>(null, null);'), ['CS0311']);
  assert.deepEqual(codes('Max<int>(1, 2); Same<string>("a", "b");'), []);
});
