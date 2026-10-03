import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { argumentStateAfterCall, membersNotNullAfterCall } from '../packages/compiler/src/nullable/attributes.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const header = '#nullable enable\nusing System;\nusing System.Diagnostics.CodeAnalysis;\n';
/** Every C# diagnostic of a program made of `members` of a static class, as `code@text`. */
function diagnostics(members, types = '') {
  const source = `${header}${types}static class P {\n${members}\n  static void Main() { }\n}\n`;
  return compile(source)
    .diagnostics.filter(d => /^CS/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
}

test('SF-A02-T05.5 corpus: attribute-driven fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'nullable-attributes');
  assert.equal(fixtures.length, 5);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T05.5 every analysis attribute binds: no CS0246, and wrong arguments are still errors', () => {
  const all = `
  [return: NotNullIfNotNull("x")] static string? Id([AllowNull] string x, [DisallowNull] string? y, [NotNull] string? z, [MaybeNull] string w) => x;
  static bool Try([NotNullWhen(true)] out string? a, [MaybeNullWhen(false)] out string b) { a = ""; b = ""; return true; }
  [DoesNotReturn] static void Fail() => throw new Exception();
  static void Check([DoesNotReturnIf(false)] bool ok) { }`;
  assert.deepEqual(diagnostics(all), []);
  assert.deepEqual(diagnostics('  static bool Try([NotNullWhen("yes")] out string? a) { a = ""; return true; }'), ['CS1503@"yes"']);
  assert.deepEqual(diagnostics('  [NotNullWhen(true)] static void M() { }'), ['CS0592@NotNullWhen']);
});

test('SF-A02-T05.5 a conditional postcondition of an out argument: no CS0165 and the right branch warns', () => {
  const tryPattern = `
  static bool Try([NotNullWhen(true)] out string? s) { s = "a"; return true; }
  static void M() { string? s; if (Try(out s)) { int a = s.Length; } else { int b = s.Length; } }`;
  assert.deepEqual(diagnostics(tryPattern), ['CS8602@s']);
  const maybeNullWhen = `
  static bool Find([MaybeNullWhen(false)] out string value) { value = ""; return true; }
  static void M() { if (Find(out var v)) { int a = v.Length; } else { int b = v.Length; } }
  static void N() { Find(out string w); }`;
  assert.deepEqual(diagnostics(maybeNullWhen), ['CS8602@v', 'CS8600@string w']);
});

test('SF-A02-T05.5 attribute readers: the state of an argument and the members a call proves', () => {
  const attributed = (...attributes) => ({ _nullableAttributes: attributes.map(([name, ...values]) => ({ name, arguments: values })) });
  assert.equal(argumentStateAfterCall(attributed(['NotNull']), null), 'notNull');
  assert.equal(argumentStateAfterCall(attributed(['NotNullWhen', true]), true), 'notNull');
  assert.equal(argumentStateAfterCall(attributed(['NotNullWhen', true]), false), null);
  assert.equal(argumentStateAfterCall(attributed(['MaybeNullWhen', false]), true), 'notNull');
  assert.equal(argumentStateAfterCall(attributed(['MaybeNullWhen', false]), false), 'maybeNull');
  assert.equal(argumentStateAfterCall(attributed(['MaybeNullWhen', false]), null), 'maybeNull', 'unknown result: the worst case');
  assert.equal(argumentStateAfterCall(attributed(), true), null);
  const method = attributed(['MemberNotNull', 'A', 'B'], ['MemberNotNullWhen', true, 'C']);
  assert.deepEqual(membersNotNullAfterCall(method, null), ['A', 'B']);
  assert.deepEqual(membersNotNullAfterCall(method, true), ['A', 'B', 'C']);
  assert.deepEqual(membersNotNullAfterCall(method, false), ['A', 'B']);
});

test('SF-A02-T05.5 preconditions, results and reachability', () => {
  const callee = '  static void M(string a, [AllowNull] string b, [DisallowNull] string? c) { }\n';
  assert.deepEqual(diagnostics(callee + '  static void N() { M("a", null, "c"); }'), []);
  assert.deepEqual(diagnostics(callee + '  static void N() { M("a", "b", null); }'), ['CS8625@null']);
  assert.deepEqual(diagnostics(callee + '  static void N(string? n) { M("a", "b", n); int l = n.Length; }'), ['CS8604@n']);
  const id = '  [return: NotNullIfNotNull("x")] static string? Id(string? x) => x;\n';
  assert.deepEqual(diagnostics(id + '  static void N(string? n) { string a = Id("a"); string b = Id(n); }'), ['CS8600@Id(n)']);
  const check = '  static void Check([DoesNotReturnIf(false)] bool ok) { if (!ok) throw new Exception(); }\n';
  assert.deepEqual(diagnostics(check + '  static int N(string? n) { Check(n != null); return n.Length; }'), []);
  assert.deepEqual(diagnostics(check + '  static int N(string? n) { Check(n == null); return n.Length; }'), ['CS8602@n']);
  const fail = '  [DoesNotReturn] static void Fail() => throw new Exception();\n';
  assert.deepEqual(diagnostics(fail + '  static int N(string? n) { if (n == null) Fail(); return n.Length; }'), []);
});

test('SF-A02-T05.5 member postconditions on the property, on its get accessor and through a receiver', () => {
  const box = accessor => `class Box {
  public string? Name;
  ${accessor}
  [MemberNotNull(nameof(Name))] public void Init() { Name = ""; }
}
`;
  const onProperty = box('[MemberNotNullWhen(true, nameof(Name))] public bool Ready => Name != null;'),
    onAccessor = box('public bool Ready { [MemberNotNullWhen(true, nameof(Name))] get { return Name != null; } }'),
    use = '  static void N(Box b) { if (b.Ready) { int x = b.Name.Length; } else { int y = b.Name.Length; } b.Init(); int z = b.Name.Length; }';
  assert.deepEqual(diagnostics(use, onProperty), ['CS8602@b.Name']);
  assert.deepEqual(diagnostics(use, onAccessor), ['CS8602@b.Name']);
});
