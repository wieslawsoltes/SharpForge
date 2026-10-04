/**
 * SF-A02-T49 / SF-A02-T50: protected access through a receiver (CS1540), the location of CS0718 and CS1662. The
 * Roslyn-pinned cases are in packages/compiler/test/differential/fixtures/protected-access.js and
 * csharp2-locations.js; these tests cover the cases around them that must stay silent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { signatureNameOf } from '../packages/compiler/src/binder/type-modifiers.js';

const diagnosticsOf = source => compile(source).diagnostics.filter(d => /^CS/.test(d.code) && d.severity === 'error');
const codesOf = source => diagnosticsOf(source).map(d => d.code);
const hierarchy = body => `class Base {
  protected int Field;
  public int Mixed { get { return 1; } protected set { } }
  protected int this[int i] { get { return i; } }
  protected static int Shared;
}
class Derived : Base { ${body} }
class Program { static void Main() { } }`;

test('SF-A02-T49 a protected member is accessible through the accessing class and classes derived from it', () => {
  assert.deepEqual(codesOf(hierarchy('void M(Derived d) { d.Field = 1; d.Mixed = 2; int x = d[0] + Field + this.Field + base.Field; Mixed = 3; }')), []);
  assert.deepEqual(codesOf(hierarchy('class Inner { void M(Derived d) { d.Field = 1; d.Mixed = 2; } }')), []);
  assert.deepEqual(codesOf(hierarchy('void M() { Base.Shared = 1; Shared = 2; }')), []);
});

test('SF-A02-T49 through a base-typed receiver it is CS1540, naming member, qualifier and accessing class', () => {
  const found = diagnosticsOf(hierarchy('void M(Base b) { b.Field = 1; b.Mixed = 2; int x = b[0]; }'));
  assert.deepEqual(found.map(d => d.code), ['CS1540', 'CS1540', 'CS1540']);
  assert.match(found[0].message, /'Base\.Field' via a qualifier of type 'Base'; the qualifier must be of type 'Derived'/);
  // Reading the property is fine: only its set accessor is protected.
  assert.deepEqual(codesOf(hierarchy('int M(Base b) { return b.Mixed; }')), []);
});

test('SF-A02-T49 CS0718 is reported on the member name for signatures and on the type argument elsewhere', () => {
  const file = parse(new SourceText('class C { Box<U> f; Box<U> M(Box<U> p) { Box<U> l = null; return l; } }', 'a.cs'));
  const names = [];
  const visit = node => {
    if (node.kind === 'GenericName') names.push(signatureNameOf(node)?.valueText ?? null);
    for (const child of node.childNodes()) visit(child);
  };
  visit(file.syntax);
  assert.deepEqual(names, ['f', 'M', 'p', null]);
});

test('SF-A02-T50 CS1662 accompanies a return value that does not convert, in anonymous methods and lambdas only', () => {
  const body = statement => `delegate int Number(); class Program { static int Plain() { ${statement} } static void Main() { } }`;
  assert.deepEqual(codesOf(body('return "text";')), ['CS0029']);
  assert.deepEqual(codesOf(body('Number n = delegate { return "text"; }; return 0;')).sort(), ['CS0029', 'CS1662']);
  assert.deepEqual(codesOf(body('Number n = () => "text"; return 0;')).sort(), ['CS0029', 'CS1662']);
  assert.deepEqual(codesOf(body('Number n = delegate { return 1; }; return n();')), []);
});
