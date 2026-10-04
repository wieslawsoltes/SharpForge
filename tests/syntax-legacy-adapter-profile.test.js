import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from '@sharpforge/syntax';
import {compile} from '@sharpforge/compiler';
import {parse as legacyParse} from './support/legacy-syntax/parser.js';

const catchKeys = ['type', 'name', 'nameSpan', 'body'];
const ordinaryCatches = [
  'try { } catch { }',
  'try { } catch (Exception error) { } finally { }',
  'try { } catch (ArgumentException error) { } catch { }'
];

for (const source of ordinaryCatches) {
  test('legacy adapter preserves the exact ordinary catch shape: ' + source, () => {
    const result = parse(source);
    const original = legacyParse(source);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(original.diagnostics, []);
    assert.deepStrictEqual(result.root, original.root);
    for (const clause of result.root.statements[0].catches) {
      assert.deepEqual(Object.keys(clause), catchKeys);
      assert.equal(Object.hasOwn(clause, 'filter'), false);
    }
  });
}

test('legacy adapter retains a written false filter and leaves the fallback catch unchanged', () => {
  const source = 'try { } catch (Exception error) when (false) { } catch { }';
  const result = parse(source);
  assert.deepEqual(result.diagnostics, []);
  const [filtered, fallback] = result.root.statements[0].catches;
  assert.deepEqual(Object.keys(filtered), ['type', 'name', 'nameSpan', 'filter', 'body']);
  assert.deepEqual(Object.keys(fallback), catchKeys);
  assert.deepEqual(filtered.filter, {
    kind: 'Literal',
    start: source.indexOf('false'),
    end: source.indexOf('false') + 5,
    uri: result.source.uri,
    value: false,
    type: 'bool'
  });
});

// Every formerly blanket-rejected source remains covered. The full compiler can
// lower these through semantic analysis even when the legacy adapter emits a
// profile diagnostic; those adapter diagnostics are not an executable-API veto.
const supported = [
  'struct S { int a; }',
  'interface I { void M(); }',
  'enum E { A }',
  'delegate void D();',
  'namespace N { struct S { } }',
  'class A { class B { } }',
  'class A { struct B { } }',
  'class A { void M(ref int x) { } }',
  'class A { int? x; }',
  'class A<T> { }',
  'class A { event System.Action E; }',
  'class A { int this[int i] { get { return 0; } } }',
  'class A { public static A operator +(A x, A y) { return x; } }',
  'class A { (int, int) t; }',
  '[System.Obsolete] class A { }',
  'class C{public int X{get;init;}}',
  'var t = (1, 2);',
  'int i = 0; L: i++; goto L;',
  'void F() { int G() { return 1; } }',
  'var x = 1.2f;',
  'var x = 1L;',
  'var x = 5000000000;',
  'int x = 1; var y = x switch { > 0 => 1, _ => 0 };'
];

// Keep statements before declarations so CS8803 does not mask the intended case.
const compileCase = source => compile('Console.WriteLine(1); ' + source);
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');

for (const source of supported) {
  test('legacy adapter public compiler accepts supported syntax: ' + source, () => {
    const result = compileCase(source);
    assert.deepEqual(errors(result), [], source);
    assert.equal(result.success, true);
    assert(result.image, 'Successful compilation must produce an executable image');
  });
}

const invalid = [
  ['class A : Base { }', 'CS0246'],
  ['class A { Foo<int> x; }', 'CS0246'],
  ['class A { int* p; }', 'CS0214'],
  ['var f = x => x;', 'CS8917'],
  ['var f = delegate { };', 'CS8917'],
  ['var q = from x in xs select x;', 'CS0103']
];

for (const [source, code] of invalid) {
  test('legacy adapter public compiler preserves invalid-source diagnostics: ' + source, () => {
    const result = compileCase(source);
    assert.equal(result.success, false);
    assert.equal(result.image, null);
    assert(errors(result).some(diagnostic => diagnostic.code === code), JSON.stringify(result.diagnostics));
    assert(!result.diagnostics.some(diagnostic => diagnostic.code === 'CS0246' &&
      /'(?:goto|is|as|int|string)'/.test(diagnostic.message)), 'Keywords must not become invented missing types');
  });
}

// These are valid source programs with actual bytecode-profile limitations.
// Inheritance declares its base so an undefined-name error cannot satisfy it.
const unsupported = [
  ['class Base { } class Derived : Base { }', /class inheritance/],
  ['class A { public virtual void M() { } }', /virtual dispatch/],
  ['var s = "x"u8;', /utf8literal expressions/],
  ['object o = 1; var b = o is int;', /type tests that need a runtime type check/, 'o is int', 'IsExpression'],
  ['object o = 1; var s = o as string;', /as expressions/, 'o as string', 'AsExpression']
];

for (const [source, limitation, expression, legacyKind] of unsupported) {
  test('legacy adapter public compiler rejects a real runtime gap: ' + source, () => {
    const result = compileCase(source);
    assert.equal(result.success, false);
    assert.equal(result.image, null);
    const diagnostics = errors(result).filter(diagnostic => diagnostic.code === 'SF2200');
    assert.equal(diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.match(diagnostics[0].message, limitation);
    assert(diagnostics[0].length > 0);
    assert(diagnostics[0].start >= 'Console.WriteLine(1); '.length);
    if (expression) {
      // Syntax recognition does not imply executable bytecode support. Both the
      // legacy diagnostic and the reconciled runtime gap point at the expression.
      const start = 'Console.WriteLine(1); '.length + source.indexOf(expression);
      assert.deepEqual(errors(result).map(({code, start, length}) => ({code, start, length})), [
        {code: 'SF2098', start, length: expression.length},
        {code: 'SF2200', start, length: expression.length}
      ]);
      assert.equal(errors(result)[0].message, `Expression '${legacyKind}' is not implemented by this profile`);
    }
  });
}
