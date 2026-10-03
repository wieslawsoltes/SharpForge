/**
 * Differential fixtures for language-version gates (SF-A02-B01): snippets of the feature matrix
 * (../../conformance/feature-snippets.js) compiled by Roslyn one language version below the feature's introduction.
 * `roslynGates` says whether Roslyn reports the "feature is not available" code there; the matrix test
 * (tests/compiler-feature-gate-matrix.test.js) checks the catalog's code and its not-gated list against these pins.
 */
import { diag, out, feature } from './kit.js';
import { featureSnippets } from '../../conformance/feature-snippets.js';

const gated = (id, featureId, langVersion, options = {}) => ({
  ...diag(id, featureSnippets[featureId], { langVersion, ...options }),
  featureId,
  roslynGates: true,
});
/** A row for which Roslyn reports a diagnostic of its own (not "feature is not available") below the row's version. */
const dedicated = (id, featureId, langVersion) => ({ ...diag(id, featureSnippets[featureId], { langVersion }), featureId, roslynGates: false });
const unsafe = { allowUnsafe: true };
const open = (id, featureId, langVersion) => ({ ...out(id, featureSnippets[featureId], { langVersion }), featureId, roslynGates: false });

export const fixtures = feature('language-version', [
  gated('gate-static-classes-at-1', 'StaticClasses', '1'),
  gated('gate-switch-on-bool-at-1', 'SwitchOnBool', '1'),
  gated('gate-auto-properties-at-2', 'AutoImplementedProperties', '2'),
  gated('gate-implicit-local-at-2', 'ImplicitLocal', '2'),
  gated('gate-implicit-array-at-2', 'ImplicitArray', '2'),
  gated('gate-async-at-4', 'Async', '4'),
  gated('gate-nameof-at-5', 'Nameof', '5'),
  gated('gate-readonly-auto-properties-at-5', 'ReadonlyAutoImplementedProperties', '5'),
  gated('gate-expression-bodied-accessor-at-6', 'ExpressionBodiedAccessor', '6'),
  gated('gate-ref-for-at-7-2', 'RefFor', '7.2'),
  gated('gate-static-local-functions-at-7-3', 'StaticLocalFunctions', '7.3'),
  gated('gate-native-int-at-8', 'NativeInt', '8'),
  gated('gate-inferred-delegate-type-at-9', 'InferredDelegateType', '9'),
  gated('gate-lambda-optional-parameters-at-11', 'LambdaOptionalParameters', '11'),
  gated('gate-instance-member-in-nameof-at-11', 'InstanceMemberInNameof', '11'),
  gated('gate-params-collections-at-12', 'ParamsCollections', '12'),
  gated('gate-extensible-fixed-at-7-2', 'ExtensibleFixedStatement', '7.2', unsafe),
  gated('gate-movable-fixed-buffers-at-7-2', 'IndexingMovableFixedBuffers', '7.2', unsafe),
  gated('gate-unmanaged-constructed-types-at-7-3', 'UnmanagedConstructedTypes', '7.3', unsafe),
  gated('gate-obsolete-accessor-at-7-3', 'ObsoleteOnPropertyAccessor', '7.3'),
  gated('gate-null-pointer-pattern-at-7-3', 'NullPointerConstantPattern', '7.3', unsafe),
  gated('gate-extension-get-async-enumerator-at-8', 'ExtensionGetAsyncEnumerator', '8'),
  gated('gate-member-not-null-at-8', 'MemberNotNull', '8'),
  gated('gate-with-on-structs-at-9', 'WithOnStructs', '9'),
  gated('gate-with-on-anonymous-types-at-9', 'WithOnAnonymousTypes', '9'),
  gated('gate-span-char-constant-pattern-at-10', 'SpanCharConstantPattern', '10'),
  // Rows Roslyn reports with a diagnostic of their own.
  dedicated('cs8314-generic-pattern-matching-at-7', 'GenericPatternMatching', '7'),
  dedicated('cs8904-static-member-variance-at-8', 'VarianceSafetyForStaticInterfaceMembers', '8'),
  dedicated('cs8704-non-public-implementation-at-9', 'ImplicitImplementationOfNonPublicMembers', '9'),
  dedicated('cs0171-auto-default-structs-at-10', 'AutoDefaultStructs', '10'),
  dedicated('cs0854-expression-optional-arguments-at-13', 'ExpressionOptionalAndNamedArguments', '13'),
  open('no-gate-first-class-span-at-13', 'FirstClassSpan', '13'),
  // Below C# 4 `dynamic` is simply an unknown type name (CS0246): Roslyn has no language-version diagnostic for it.
  { ...diag('no-gate-dynamic-at-3', featureSnippets.Dynamic, { langVersion: '3' }), featureId: 'Dynamic', roslynGates: false },
  open('no-gate-null-coalescing-at-1', 'NullCoalescing', '1'),
  open('no-gate-method-group-conversions-at-1', 'MethodGroupConversions', '1'),
]);
