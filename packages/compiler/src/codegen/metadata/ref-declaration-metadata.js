/** Parameter/return markers that distinguish readonly and scoped references from ordinary CLR byrefs. */
import { encodeCustomAttribute, token } from '@sharpforge/cil';
import { RefKind, SymbolKind } from '../../symbols/types.js';
import { AttributeTargets } from '../../symbols/attribute-types.js';
import { markerAttributeContract, fieldAttributeContract } from './compiler-attribute-symbols.js';
import { compilerAttributeConstructorToken } from './compiler-attribute-definitions.js';

const IS_READONLY = 'System.Runtime.CompilerServices.IsReadOnlyAttribute';
const REQUIRES_LOCATION = 'System.Runtime.CompilerServices.RequiresLocationAttribute';
const SCOPED_REF = 'System.Runtime.CompilerServices.ScopedRefAttribute';
const REF_SAFETY_RULES = 'System.Runtime.CompilerServices.RefSafetyRulesAttribute';

function refParameterMarkers(parameter) {
  const names = [];
  if (parameter.refKind === RefKind.In) names.push(IS_READONLY);
  if (parameter.refKind === RefKind.RefReadOnlyParameter) names.push(REQUIRES_LOCATION);
  if (parameter.scoped && parameter.refKind !== RefKind.Out) names.push(SCOPED_REF);
  return names;
}

/** Attribute requirements are determined before the registry's local definitions receive TypeDef tokens. */
export function planRefDeclarationAttributes(registry, plans, version) {
  const names = new Set();
  for (const plan of plans.values()) {
    for (const planned of plan.methods) {
      const method = planned.symbol ?? planned.shape;
      if (hasReadonlyReturn(method)) names.add(IS_READONLY);
      for (const parameter of method?.parameters ?? []) for (const name of refParameterMarkers(parameter)) names.add(name);
    }
  }
  for (const fullName of names) {
    const usage = fullName === SCOPED_REF ? { targets: AttributeTargets.Parameter, allowMultiple: false, inherited: false } : null;
    registry.getOrCreate(fullName, (analysis, existing) => markerAttributeContract(analysis, existing, { fullName, usage }));
  }
  if (version) registry.getOrCreate(REF_SAFETY_RULES, (analysis, existing) => fieldAttributeContract(analysis, existing, {
    fullName: REF_SAFETY_RULES, fieldName: 'Version', fieldType: analysis.core.int,
    usage: { targets: AttributeTargets.Module, allowMultiple: false, inherited: false },
  }));
}

function writeMarker(attributes, parent, fullName) {
  const contract = attributes.writer.compilerAttributes.get(fullName);
  const constructor = compilerAttributeConstructorToken(attributes, contract);
  attributes.add(parent, constructor, encodeCustomAttribute([], []));
}

/** Return parameters need a Param row when the source return is readonly, even without user attributes. */
export function hasReadonlyReturn(method) {
  return method?.refKind === RefKind.RefReadOnly;
}

/** `in` and `ref readonly` have distinct attributes; `out` is already scoped under the C# 11 rules. */
export function writeRefParameterAttributes(attributes, parent, parameter) {
  for (const name of refParameterMarkers(parameter)) writeMarker(attributes, parent, name);
}

/** A readonly return carries both this attribute and the signature's modreq(InAttribute). */
export function writeReadonlyReturnAttribute(attributes, parent, method) {
  if (hasReadonlyReturn(method)) writeMarker(attributes, parent, IS_READONLY);
}

/** Select the module's declared ref-safety rules from its actual source language version. */
export function declarationRefSafetyVersion(analysis) {
  if (analysis.files.some(file => analysis.versionOf(file.source.uri).number >= 11)) return 11;
  const feature = analysis.references?.manager?.corLibrary?.getTypeByMetadataName('System.Runtime.CompilerServices.RuntimeFeature');
  const supportsByRefFields = feature?.getMembers('ByRefFields').some(field => field.kind === SymbolKind.Field && field.isConst &&
    field.type.specialType === 'System_String' && field.constantValue?.value === 'ByRefFields');
  return supportsByRefFields ? 11 : null;
}

/** The version describes invocation escape rules, rather than the version of the referenced runtime. */
export function writeRefSafetyRulesAttribute(attributes) {
  const version = attributes.writer.refSafetyRulesVersion;
  if (!version) return;
  const contract = attributes.writer.compilerAttributes.get(REF_SAFETY_RULES);
  const constructor = compilerAttributeConstructorToken(attributes, contract);
  attributes.add(token(0, 1), constructor, encodeCustomAttribute(['int'], [version]));
}
