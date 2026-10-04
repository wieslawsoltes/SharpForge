import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { nullabilityViolations } from '../packages/compiler/src/nullable/constraint-checks.js';
import { compareSignatureNullability } from '../packages/compiler/src/nullable/signature-checks.js';
import { NullableAnnotation, TypeKind } from '../packages/compiler/src/symbols/types.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

/** The C# diagnostics of a program, as `code@text`. */
function diagnostics(source) {
  return compile(source)
    .diagnostics.filter(d => /^CS/.test(d.code))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
}
const types = 'interface I<T> where T : notnull { }\nclass G<T> where T : class { }\nclass Shape { }\nclass H<T> where T : Shape { }\n';
/** Only the nullable warnings: the fields of these programs are also 'assigned but never used' (CS0414). */
const nullableWarnings = source => diagnostics(source).filter(d => /^CS8[67]/.test(d));
const main = 'static class P { static void Main() { } }\n';

test('SF-A02-T05.6 corpus: constraint and signature nullability fixtures match Roslyn', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'nullable-constraints');
  assert.equal(fixtures.length, 6);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T05.6 the rules: which type arguments violate which constraint', () => {
  const enabled = () => true,
    disabled = () => false,
    location = [{ uri: 'a.cs', start: 0 }],
    string = { name: 'string', isReferenceType: true, toDisplayString: () => 'string' },
    int = { name: 'int', isReferenceType: false, toDisplayString: () => 'int' },
    nullableInt = { isNullableValueType: true, isReferenceType: false, toDisplayString: () => 'int?' },
    shape = { name: 'Shape', isReferenceType: true, toDisplayString: () => 'Shape' },
    parameter = (flags = {}, constraintTypes = []) => ({ name: 'T', typeKind: TypeKind.TypeParameter, locations: location, constraintTypes, ...flags }),
    argument = (type, nullableAnnotation = NullableAnnotation.NotAnnotated) => ({ type, nullableAnnotation }),
    codes = (p, a, isAnnotationContext = enabled) => nullabilityViolations([p], [a], { display: 'G<T>', isAnnotationContext }).map(v => v.code);

  const notNull = parameter({ hasNotNullConstraint: true }),
    classConstraint = parameter({ hasReferenceTypeConstraint: true }),
    nullableClass = parameter({ hasReferenceTypeConstraint: true, referenceTypeConstraintIsNullable: true }),
    typeConstraint = parameter({}, [shape]);
  assert.deepEqual(codes(notNull, argument(string, NullableAnnotation.Annotated)), ['CS8714']);
  assert.deepEqual(codes(notNull, argument(nullableInt)), ['CS8714']);
  assert.deepEqual(codes(notNull, argument(string)), []);
  assert.deepEqual(codes(notNull, argument(int)), []);
  assert.deepEqual(codes(notNull, argument(nullableInt), disabled), ['CS8714'], 'notnull counts wherever it was written');
  assert.deepEqual(codes(classConstraint, argument(string, NullableAnnotation.Annotated)), ['CS8634']);
  assert.deepEqual(codes(classConstraint, argument(string, NullableAnnotation.Annotated), disabled), [], 'an oblivious constraint');
  assert.deepEqual(codes(nullableClass, argument(string, NullableAnnotation.Annotated)), []);
  assert.deepEqual(codes(typeConstraint, argument(shape, NullableAnnotation.Annotated)), ['CS8631']);
  assert.deepEqual(codes({ ...typeConstraint, nullableConstraintTypes: new Set([shape]) }, argument(shape, NullableAnnotation.Annotated)), []);

  // A type parameter as the argument: possibly null unless something constrains it.
  const open = parameter(),
    openArgument = { type: { ...open, toDisplayString: () => 'U' }, nullableAnnotation: NullableAnnotation.NotAnnotated },
    notNullArgument = { type: { ...notNull, toDisplayString: () => 'U' }, nullableAnnotation: NullableAnnotation.NotAnnotated };
  assert.deepEqual(codes(notNull, openArgument), ['CS8714']);
  assert.deepEqual(codes(notNull, notNullArgument), []);
  const violation = nullabilityViolations([notNull], [argument(string, NullableAnnotation.Annotated)], { display: 'I<T>', isAnnotationContext: enabled })[0];
  assert.deepEqual(violation.args, ['I<T>', 'T', 'string?']);
});

test('SF-A02-T05.6 the warnings belong to the nullable warning context of the use', () => {
  const use = 'class Uses { I<int?>? a; G<string?>? b; H<Shape?>? c; void M() { a = null; b = null; c = null; } }\n';
  assert.deepEqual(nullableWarnings('#nullable enable\n' + types + use + main), ['CS8714@a', 'CS8634@b', 'CS8631@c']);
  assert.deepEqual(nullableWarnings(types + '#nullable enable\n' + use + main), ['CS8714@a'], 'class and type constraints written without annotations');
  const disabledUse = 'class Uses { I<int?> a; void M() { a = null; } }\n';
  assert.deepEqual(nullableWarnings('#nullable enable\n' + types + '#nullable disable\n' + disabledUse + main), []);
});

test('SF-A02-T05.6 inferred type arguments follow the null-state of the arguments', () => {
  const program = body =>
    `#nullable enable\nstatic class P {\n  static void M<T>(T t) where T : notnull { }\n  static void N(string? maybe, string sure) { ${body} }\n  static void Main() { }\n}\n`;
  assert.deepEqual(diagnostics(program('M(maybe);')), ['CS8714@M']);
  assert.deepEqual(diagnostics(program('M(sure);')), []);
  assert.deepEqual(diagnostics(program('if (maybe != null) M(maybe);')), []);
  assert.deepEqual(diagnostics(program('M<string?>(sure);')), ['CS8714@M<string?>']);
  assert.deepEqual(diagnostics(program('M<int?>(1);')), ['CS8714@M<int?>']);
});

test('SF-A02-T05.6 signature comparison: variance at the top level, none below it, one family per relation', () => {
  const string = { isReferenceType: true },
    box = typeArgument => ({ isReferenceType: true, typeArguments: [typeArgument] }),
    of = (type, nullableAnnotation) => ({ type, nullableAnnotation }),
    plain = of(string, NullableAnnotation.NotAnnotated),
    nullable = of(string, NullableAnnotation.Annotated),
    oblivious = of(string, NullableAnnotation.Oblivious),
    signature = (returns, ...parameters) => ({
      returnTypeWithAnnotations: returns,
      parameters: parameters.map((typeWithAnnotations, index) => ({ name: 'p' + index, refKind: 'none', typeWithAnnotations })),
    }),
    family = {
      returns: { top: 'R', nested: 'r' },
      parameter: { top: 'P', nested: 'p' },
      returnArgs: () => [],
      parameterArgs: name => [name],
    },
    codes = (derived, base) => compareSignatureNullability(derived, base, family).map(d => d.code + (d.args[0] ?? ''));
  assert.deepEqual(codes(signature(nullable), signature(plain)), ['R'], 'an override may not return null where the base does not');
  assert.deepEqual(codes(signature(plain), signature(nullable)), []);
  assert.deepEqual(codes(signature(plain, plain), signature(plain, nullable)), ['Pp0']);
  assert.deepEqual(codes(signature(plain, nullable), signature(plain, plain)), []);
  assert.deepEqual(codes(signature(nullable, plain), signature(plain, nullable)), ['R'], 'the return type is reported alone');
  assert.deepEqual(codes(signature(oblivious, oblivious), signature(plain, nullable)), [], 'oblivious matches anything');
  const boxOfNullable = of(box(nullable), NullableAnnotation.NotAnnotated),
    boxOfPlain = of(box(plain), NullableAnnotation.NotAnnotated);
  assert.deepEqual(codes(signature(boxOfNullable), signature(boxOfPlain)), ['r']);
  assert.deepEqual(codes(signature(boxOfPlain), signature(boxOfNullable)), ['r'], 'type arguments are invariant');
  assert.deepEqual(codes(signature(plain, boxOfNullable, plain), signature(plain, boxOfPlain, nullable)), ['pp0', 'Pp1']);
});

test('SF-A02-T05.6 nullable annotations are not part of type identity: no false override or implementation errors', () => {
  const source = `#nullable enable
class Box<T> { }
interface IThing { Box<string> Items(Box<string?> keys); }
class Thing : IThing { public Box<string?> Items(Box<string> keys) => new Box<string?>(); }
abstract class Base { public abstract Box<string> Items(Box<string?> keys); }
class Derived : Base { public override Box<string?> Items(Box<string> keys) => new Box<string?>(); }
${main}`;
  assert.deepEqual(diagnostics(source), ['CS8613@Items', 'CS8609@Items']);
});
