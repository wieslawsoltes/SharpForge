/**
 * Language-version gates for semantic-only features (SF-A02-T12.3 / B01).
 *
 * The parser gates what it can see in the token stream (packages/syntax `checkFeatures`). Features that only binding
 * can recognise - async Main, covariant returns, default interface implementations, static abstract members,
 * native-sized integers, readonly members, ref reassignment, parameterless struct constructors, first-class spans,
 * inferred tuple names, target-typed conditional, unmanaged/Enum/Delegate constraints ... - are gated here with the
 * same catalog (`languageFeature(id)`), so syntax and semantic rows share one feature id, name and version.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { languageFeature, languageFeatures, featureAvailability, parseLanguageVersion, checkFeatures } from '@sharpforge/syntax';
import { collectSyntaxFeatures } from './syntax-features.js';

/** The newest released language version of the catalog; below it a feature gate can fire for a released feature. */
export const newestLanguageVersion = Math.max(...languageFeatures.filter(row => !row.preview).map(row => row.version));

/** The diagnostic codes of "feature is not available in this language version" (one per selected version, and preview). */
export const featureDiagnosticCodes = new Set(
  'CS8022 CS8023 CS8024 CS8025 CS8026 CS8059 CS8107 CS8302 CS8320 CS8370 CS8400 CS8773 CS8936 CS9058 CS9202 CS9260 CS9327 CS8652'.split(' '),
);
// Non-trailing named arguments have a diagnostic of their own that names the version (binder/csharp7x.js).
featureDiagnosticCodes.add(DiagnosticId.CS1738);

/**
 * The language-version diagnostics of one parsed file: the features the parser recorded and, when a version below
 * the newest is selected, the features only the syntax tree shows (./syntax-features.js).
 * @param file a `parse()` result (`source`, `features`, `syntax`)  @param version the selected language version
 */
export function featureDiagnosticsOf(file, version) {
  const recorded = file.features ?? [],
    needsWalk = !!file.syntax && version.number < newestLanguageVersion;
  if (!needsWalk) return recorded.length ? checkFeatures(file.source, recorded, version) : [];
  const ids = new Set(recorded.map(use => use.id)),
    // A feature the parser records is the parser's to report: the walker only adds the ones it never saw.
    found = collectSyntaxFeatures(file.syntax).filter(use => !ids.has(use.id));
  return checkFeatures(file.source, [...recorded, ...found], version);
}

/** Semantic features the binder gates: binder-facing key -> A01 catalog feature id. */
export const semanticFeatures = Object.freeze({
  asyncMain: 'AsyncMain',
  covariantReturns: 'CovariantReturnsForOverrides',
  defaultInterfaceImplementation: 'DefaultInterfaceImplementation',
  staticAbstractMembers: 'StaticAbstractMembersInInterfaces',
  nativeInt: 'NativeInt',
  readonlyMembers: 'ReadOnlyMembers',
  readonlyStructs: 'ReadOnlyStructs',
  refStructs: 'RefStructs',
  refReassignment: 'RefReassignment',
  refConditional: 'RefConditional',
  refLocalsReturns: 'RefLocalsReturns',
  parameterlessStructConstructors: 'ParameterlessStructConstructors',
  structFieldInitializers: 'StructFieldInitializers',
  inferredTupleNames: 'InferredTupleNames',
  targetTypedConditional: 'TargetTypedConditional',
  unmanagedConstraint: 'UnmanagedGenericTypeConstraint',
  enumConstraint: 'EnumGenericTypeConstraint',
  delegateConstraint: 'DelegateGenericTypeConstraint',
  notNullConstraint: 'NotNullGenericTypeConstraint',
  genericAttributes: 'GenericAttributes',
  refStructInterfaces: 'RefStructInterfaces',
  allowsRefStruct: 'AllowsRefStructConstraint',
  firstClassSpan: 'FirstClassSpan',
  improvedOverloadCandidates: 'ImprovedOverloadCandidates',
  nullableReferenceTypes: 'NullableReferenceTypes',
  unconstrainedTypeParameterInNullCoalescing: 'UnconstrainedTypeParameterInNullCoalescingOperator',
  extensionGetEnumerator: 'ExtensionGetEnumerator',
  numericIntPtr: 'NumericIntPtr',
  privateProtected: 'PrivateProtected',
  tupleEquality: 'TupleEquality',
  recordStructs: 'RecordStructs',
  lambdaReturnType: 'LambdaReturnType',
  inferredDelegateType: 'InferredDelegateType',
  userDefinedCompoundAssignment: 'UserDefinedCompoundAssignmentOperators',
});
/** The catalog row of a semantic feature key, or null when the syntax catalog does not list it (then the fallback name/version apply). */
export function semanticFeature(key) {
  const id = semanticFeatures[key] ?? key;
  return languageFeature(id) ?? null;
}
/**
 * Checks one semantic feature against the selected language version.
 * @param {string} key a key of `semanticFeatures` or a catalog feature id  @param version LangVersion text or parsed version
 * @param {{name:string,version:number}} [fallback] used when the catalog has no such row
 * @returns {null|{code:string,message:string,args:string[]}} the Roslyn "feature not available" diagnostic, or null when available
 */
export function checkSemanticFeature(key, version, fallback = null) {
  const id = semanticFeatures[key] ?? key,
    row = languageFeature(id);
  if (row) return featureAvailability(id, version);
  if (!fallback) return null;
  const selected = typeof version === 'object' && version ? version : (parseLanguageVersion(version) ?? parseLanguageVersion('default'));
  if (selected.number >= fallback.version) return null;
  const display = n => (Number.isInteger(n) ? (n >= 7 ? n + '.0' : String(n)) : String(n)),
    codes = {
      1: DiagnosticId.CS8022,
      2: DiagnosticId.CS8023,
      3: DiagnosticId.CS8024,
      4: DiagnosticId.CS8025,
      5: DiagnosticId.CS8026,
      6: DiagnosticId.CS8059,
      7: DiagnosticId.CS8107,
      7.1: DiagnosticId.CS8302,
      7.2: DiagnosticId.CS8320,
      7.3: DiagnosticId.CS8370,
      8: DiagnosticId.CS8400,
      9: DiagnosticId.CS8773,
      10: DiagnosticId.CS8936,
      11: DiagnosticId.CS9058,
      12: DiagnosticId.CS9202,
      13: DiagnosticId.CS9260,
      14: DiagnosticId.CS9327,
    };
  return {
    code: codes[selected.number] ?? DiagnosticId.CS9058,
    message:
      `Feature '${fallback.name}' is not available in C# ${display(selected.number)}. ` +
      `Please use language version ${display(fallback.version)} or greater.`,
  };
}
/** A binder-side gate: `gate(node,key,fallback)` reports through `report(node,code,message)` once per node and returns whether the feature is available. */
export function createFeatureGate(versionOf, report) {
  const seen = new Set();
  return (uri, node, key, fallback = null) => {
    const result = checkSemanticFeature(key, versionOf(uri), fallback);
    if (!result) return true;
    const span = node.span ?? node,
      id = uri + ':' + span.start + ':' + key;
    if (!seen.has(id)) {
      seen.add(id);
      report(uri, node, result.code, result.message);
    }
    return false;
  };
}
