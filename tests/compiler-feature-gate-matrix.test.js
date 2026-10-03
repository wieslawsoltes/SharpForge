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
const notGated = {
  // ---- C# 2 - C# 12 rows without a Roslyn gate ----
  ...Object.fromEntries(
    (
      'GenericConstraints GenericMethods NullCoalescing YieldStatement MethodGroupConversions CovarianceForDelegates FriendAssemblies ' +
      'PragmaWarning PragmaChecksum AliasQualifiedNames ExpressionTrees QueryContinuation QueryJoin QueryGroupBy QueryOrderBy QueryLet ' +
      'EmbeddedInteropTypes IndexedProperties CallerInfoAttributes AwaitExpression AwaitInCatchAndFinally ExtensionAddMethods ' +
      'ParameterlessStructInitializers Deconstruction GeneralizedAsyncReturnTypes IsPatternExpression CaseGuards OverrideWithConstraints ' +
      'PropertyPatterns PositionalPatterns NullForgivingOperator NullableDirective WithExpressions ' +
      'UnmanagedCallingConventions AsyncMethodBuilderOverride CallerArgumentExpression ExtendedNameofScope NumericIntPtr ' +
      'SlicePattern ExperimentalAttribute SpreadElement'
    )
      .split(' ')
      .map(id => [id, noRoslynGate]),
  ),
  // ---- directives Roslyn does not gate by language version (pinned in packages/syntax/test/gates) ----
  LineSpanDirective: 'Roslyn accepts the span form of #line at every language version: it reports nothing at C# 9',
  IgnoredDirectives: "Roslyn reports CS9298 for '#:' outside a file-based program at every version, not a language-version diagnostic",
  // ---- features that need binding the compiler does not do for the gate ----
  Dynamic: 'below C# 4 Roslyn reports CS0246 for the type name `dynamic`, not a language-version diagnostic (pinned)',
  ScopedRef: "Roslyn has no feature of this name: it reports `scoped` as 'ref fields' (CS8936 at the keyword); the walker does the same (pinned)",
  InferredTupleNames: 'Roslyn reports CS8306 where an inferred name is used, not a feature diagnostic; the binder does the same',
  NonTrailingNamedArguments: 'Roslyn reports CS1738 on the positional argument, naming the version; the binder does the same (pinned)',
  GenericPatternMatching: 'below C# 7.1 Roslyn reports CS8314 for the pattern, naming the version; the binder does the same (pinned)',
  ImprovedOverloadCandidates: 'changes which candidates overload resolution keeps; there is no construct to report',
  NameShadowingInNestedFunctions: 'below C# 8 Roslyn reports CS0136, not a language-version diagnostic',
  TargetTypedConditional: 'below C# 9 Roslyn reports CS8957 for the conditional, not a language-version diagnostic (pinned)',
  VarianceSafetyForStaticInterfaceMembers:
    'below C# 9 Roslyn reports CS8904 for the variance violation, naming the version; the binder does the same (pinned)',
  ImplicitImplementationOfNonPublicMembers:
    'below C# 10 Roslyn reports CS8704 on the implementing member, naming the version; the binder does the same (pinned)',
  ImprovedInterpolatedStrings: 'needs interpolated string handler conversions, which are not bound yet (SF-A02-T75)',
  AutoDefaultStructs: 'below C# 11 Roslyn reports CS0171 for the unassigned field, not a language-version diagnostic; the binder does the same (pinned)',
  CacheStaticMethodGroupConversion: 'only changes code generation in Roslyn; there is no diagnostic',
  LockObject: 'needs System.Threading.Lock in the framework registry (the type is unknown: CS0246)',
  FirstClassSpan: 'Roslyn reports nothing for the snippet below C# 14 (the conversion exists as a user-defined one); pinned',
  ExpressionOptionalAndNamedArguments:
    'below C# 14 Roslyn reports CS0854 / CS0853 for the call, not a language-version diagnostic; the binder does the same (pinned)',
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
  return compile([file], { langVersion: versionText(version), allowUnsafe: /\bunsafe\b/.test(featureSnippets[row.id]) });
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
  assert(gated.length >= 172, `only ${gated.length} rows are gated`);
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

// The catalog rows that the syntax walker (binder/syntax-features.js) decides, without the parser and without binding.
const walkerRows = (
  'AutoImplementedProperties ReadonlyAutoImplementedProperties Discards RefExtensionMethods RefConditional RefFor RefForEach ' +
  'EnumGenericTypeConstraint DelegateGenericTypeConstraint UnmanagedGenericTypeConstraint NotNullGenericTypeConstraint NestedStackalloc ' +
  'SealedToStringInRecord PositionalFieldsInRecords ConstantInterpolatedStrings RelaxedShiftOperator RefFields ImplicitIndexerInitializer ' +
  'RefUnsafeInIteratorAsync'
).split(' ');

test('A02-B01 gate spans agree with Roslyn for every pinned gated row, which include all rows the syntax walker decides', () => {
  const pinned = loadPinned().results,
    gatedFixtures = roslynFixtures.filter(fixture => fixture.roslynGates);
  const pinnedRows = new Set(gatedFixtures.map(fixture => fixture.featureId));
  assert.deepEqual(walkerRows.filter(id => !pinnedRows.has(id)), [], 'walker rows without a Roslyn pin');
  for (const fixture of gatedFixtures) {
    const row = languageFeatures.find(r => r.id === fixture.featureId),
      show = (start, length) => `${row.code}@${start}+${length} ${JSON.stringify(fixture.source.slice(start, start + length))}`;
    // Roslyn's and SharpForge's diagnostics with the row's code, each as code, start and length over the fixture text.
    const theirs = pinned.get(fixture.id).diagnostics.filter(d => d[0] === row.code).map(d => show(d[1], d[2]));
    const result = compile(fixture.source, { langVersion: fixture.langVersion, allowUnsafe: !!fixture.allowUnsafe });
    const mine = result.diagnostics.filter(d => d.code === row.code).map(d => show(d.start, d.length));
    assert(theirs.length > 0, fixture.id);
    assert.deepEqual(mine, theirs, fixture.id);
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
    'Async:M',
    'StaticLocalFunctions:L',
    'RefFor:ref int',
  ]);
  // At the newest language version nothing is gated and the program is not walked for features.
  assert.deepEqual(
    compile('class P { int A { get; } static void Main() { } }').diagnostics.filter(d => /^Feature '/.test(d.message)),
    [],
  );
});
