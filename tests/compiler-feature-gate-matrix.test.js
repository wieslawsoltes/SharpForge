import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFeatures, previousLanguageVersion } from '@sharpforge/syntax';
import { compile } from '@sharpforge/compiler';
import { featureSnippets } from '../packages/compiler/test/conformance/feature-snippets.js';
import { collectSyntaxFeatures } from '../packages/compiler/src/binder/syntax-features.js';
import { fixtures as roslynFixtures } from '../packages/compiler/test/differential/fixtures/feature-gates.js';
import { loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';

// SF-A02-B01: every row of the feature catalog is either gated (the snippet reports the Roslyn "feature is not
// available" code one version below the row's introduction and nothing at the introduction version) or listed in
// `notGated` with the reason. A row in neither set fails the test.

const versionText = version => (version === 15 ? 'preview' : String(version));

/** Names the execution binder uses for the features it gates itself (they predate the catalog). */
const binderNames = {
  ImplicitObjectCreation: 'Target-typed new',
  FieldKeyword: 'Field-backed properties',
  CollectionExpressionArguments: 'Collection expression constructor arguments',
};

const noRoslynGate = 'Roslyn has no MessageID for this row: csc reports no language-version diagnostic for it';
const needsAttributeBinding = 'gated by Roslyn where the attribute is bound; attributes are not bound here';
const needsOperandTypes = 'depends on the types of the operands, which only overload resolution or conversion classification knows';
const notGated = {
  // ---- C# 2 - C# 12 rows without a Roslyn gate ----
  ...Object.fromEntries(
    (
      'GenericConstraints GenericMethods NullCoalescing YieldStatement MethodGroupConversions CovarianceForDelegates FriendAssemblies ' +
      'PragmaWarning PragmaChecksum AliasQualifiedNames ExpressionTrees QueryContinuation QueryJoin QueryGroupBy QueryOrderBy QueryLet ' +
      'EmbeddedInteropTypes IndexedProperties CallerInfoAttributes AwaitExpression AwaitInCatchAndFinally ExtensionAddMethods ' +
      'ParameterlessStructInitializers Deconstruction GeneralizedAsyncReturnTypes IsPatternExpression CaseGuards OverrideWithConstraints ' +
      'PropertyPatterns PositionalPatterns NullForgivingOperator NullableDirective PragmaWarningEnable WithExpressions ' +
      'UnmanagedCallingConventions AsyncMethodBuilderOverride CallerArgumentExpression ExtendedNameofScope NumericIntPtr ScopedRef ' +
      'SlicePattern ExperimentalAttribute SpreadElement'
    )
      .split(' ')
      .map(id => [id, noRoslynGate]),
  ),
  // ---- features that need binding the compiler does not do for the gate ----
  Dynamic: 'below C# 4 Roslyn reports CS0246 for the type name `dynamic`, not a language-version diagnostic (pinned)',
  InferredTupleNames: 'needs the binder to know that a tuple element name was inferred where it is used',
  GenericPatternMatching: needsOperandTypes,
  ImprovedOverloadCandidates: 'changes which candidates overload resolution keeps; there is no construct to report',
  ExtensibleFixedStatement: needsOperandTypes,
  IndexingMovableFixedBuffers: needsOperandTypes,
  UnconstrainedTypeParameterInNullCoalescingOperator: needsOperandTypes,
  DisposalPattern: needsOperandTypes,
  NameShadowingInNestedFunctions: 'below C# 8 Roslyn reports CS0136, not a language-version diagnostic',
  UnmanagedConstructedTypes: needsOperandTypes,
  ObsoleteOnPropertyAccessor: needsAttributeBinding,
  NullPointerConstantPattern: needsOperandTypes,
  AsyncUsing: 'the parser records `await using` as AsyncStreams, so it is reported with that feature name',
  TargetTypedConditional: needsOperandTypes,
  ModuleInitializers: needsAttributeBinding,
  ExtensionGetEnumerator: needsOperandTypes,
  ExtensionGetAsyncEnumerator: needsOperandTypes,
  MemberNotNull: needsAttributeBinding,
  VarianceSafetyForStaticInterfaceMembers: 'needs the variance check of interface members',
  WithOnStructs: needsOperandTypes,
  WithOnAnonymousTypes: needsOperandTypes,
  InferredDelegateType: needsOperandTypes,
  ImplicitImplementationOfNonPublicMembers: 'needs the interface implementation map',
  ImprovedInterpolatedStrings: needsOperandTypes,
  AutoDefaultStructs: 'needs definite assignment of struct fields in constructors',
  CacheStaticMethodGroupConversion: 'only changes code generation in Roslyn; there is no diagnostic',
  SpanCharConstantPattern: needsOperandTypes,
  FileTypes: 'the parser does not accept the `file` modifier on a type (syntax package defect)',
  InstanceMemberInNameof: needsOperandTypes,
  InlineArrays: needsOperandTypes,
  LockObject: needsOperandTypes,
  OverloadResolutionPriority: needsAttributeBinding,
  FirstClassSpan: needsOperandTypes,
  ExpressionOptionalAndNamedArguments: 'needs expression-tree conversion of lambdas',
};

/**
 * Gated rows whose snippet makes compile() throw at the introduction version, outside the gate itself. The gate is
 * still asserted one version below; the entry must be removed when the crash is fixed (the test then fails).
 */
const crashesAtOwnVersion = {};

/** The diagnostics of `result` that are the language-version gate of `row`. */
function gateDiagnostics(result, row) {
  // A row with a dedicated Roslyn diagnostic (for example the warning CS8371) is recognised by its code: its message does not name the feature.
  if (row.dedicatedMessage) return result.diagnostics.filter(d => d.code === row.code);
  const names = [row.name, binderNames[row.id]].filter(Boolean).map(name => `'${name.toLowerCase()}'`);
  return result.diagnostics.filter(d => d.code === row.code && names.some(name => d.message.toLowerCase().includes(name)));
}
// Exercise feature gates on an already parsed tree. Text-input grammar selection is tested separately: contextual
// words such as `record` and `extension` intentionally parse as identifiers below their introduction versions.
const compileAt = (row, version) => {
  const file = parse(new SourceText(featureSnippets[row.id]), undefined, { languageVersion: 'preview' });
  return compile([file], { langVersion: versionText(version) });
};

test('A02-B01 every catalog row has exactly one snippet and is either gated or listed as not gated', () => {
  const ids = languageFeatures.map(row => row.id);
  assert.deepEqual(Object.keys(featureSnippets).sort(), [...ids].sort());
  assert(ids.length > 300, `catalog has ${ids.length} rows`);
  for (const id of Object.keys(notGated)) {
    const row = languageFeatures.find(r => r.id === id);
    assert(row, `notGated lists ${id}, which is not a catalog row`);
    assert(row.version > 1, `${id} is a C# 1 feature: nothing can gate it`);
    assert(notGated[id].length > 10, `${id} needs a reason`);
  }
  const gated = languageFeatures.filter(row => row.version > 1 && !(row.id in notGated));
  assert(gated.length >= 140, `only ${gated.length} rows are gated`);
});

for (const row of languageFeatures) {
  if (row.version === 1) continue; // There is no language version below C# 1.
  const below = previousLanguageVersion(row.version);
  if (row.id in notGated) {
    test(`A02-B01 not gated (${notGated[row.id]}): ${row.id}`, () => {
      const result = compileAt(row, below);
      assert.deepEqual(gateDiagnostics(result, row), [], `${row.id} is gated now: remove it from notGated`);
    });
    continue;
  }
  test(`A02-B01 C# ${versionText(row.version)} feature is gated at ${versionText(below)}: ${row.id}`, () => {
    const low = gateDiagnostics(compileAt(row, below), row);
    assert(low.length > 0, `${row.id}: no ${row.code} for '${row.name}' at language version ${versionText(below)}`);
    assert(low.every(d => d.severity === row.severity));
    if (row.id in crashesAtOwnVersion) {
      assert.throws(() => compileAt(row, row.version), TypeError, `${row.id} no longer crashes: remove it from crashesAtOwnVersion`);
      return;
    }
    assert.deepEqual(gateDiagnostics(compileAt(row, row.version), row), [], `${row.id} is reported at its own version`);
    // Any feature diagnostic at the introduction version would mean the snippet uses a newer feature.
    const own = compileAt(row, row.version).diagnostics.filter(d => /^Feature '|currently in Preview/.test(d.message));
    assert.deepEqual(own.map(d => d.message), [], `${row.id}: the snippet needs a newer language version`);
  });
}

test('A02-B01 C# 1 snippets report no language-version diagnostic at language version 1', () => {
  for (const row of languageFeatures.filter(r => r.version === 1)) {
    const gates = compileAt(row, 1).diagnostics.filter(d => /^Feature '/.test(d.message));
    assert.deepEqual(gates.map(d => d.message), [], row.id);
  }
});

test('A02-B01 gate codes agree with Roslyn for the pinned rows', () => {
  const pinned = loadPinned().results;
  assert(roslynFixtures.length >= 8);
  for (const fixture of roslynFixtures) {
    const row = languageFeatures.find(r => r.id === fixture.featureId),
      pin = pinned.get(fixture.id);
    assert(row && pin, fixture.id);
    assert.equal(fixture.source, featureSnippets[row.id], `${fixture.id} pins the matrix snippet`);
    assert.equal(fixture.langVersion, versionText(previousLanguageVersion(row.version)));
    const roslynCodes = pin.diagnostics.filter(d => d[3] === 'error').map(d => d[0]);
    if (fixture.roslynGates) {
      assert(roslynCodes.includes(row.code), `${fixture.id}: Roslyn reports ${roslynCodes.join(',')}, the catalog says ${row.code}`);
      assert(!(row.id in notGated), `${row.id} is gated by Roslyn`);
    } else {
      assert(!roslynCodes.includes(row.code), `${fixture.id}: Roslyn gates this row`);
      assert(row.id in notGated, `${row.id}: Roslyn has no gate, so the row belongs in notGated`);
    }
  }
});

test('A02-B01 the syntax walker finds features the parser does not record', () => {
  const source =
    'class P { int A { get; } static async void M(int[] a) { static int L() { return 1; } L(); ' +
    'for (ref int r = ref a[0]; ; ) { } } }';
  const file = parse(new SourceText(source, 'a.cs'));
  const found = collectSyntaxFeatures(file.syntax).map(use => use.id + ':' + source.slice(use.start, use.end));
  assert.deepEqual(found, [
    'AutoImplementedProperties:A',
    'ReadonlyAutoImplementedProperties:A',
    'Async:async',
    'StaticLocalFunctions:L',
    'RefFor:ref int',
  ]);
  // At the newest language version nothing is gated and the program is not walked for features.
  assert.deepEqual(
    compile('class P { int A { get; } static void Main() { } }').diagnostics.filter(d => /^Feature '/.test(d.message)),
    [],
  );
});
