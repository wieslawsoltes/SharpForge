/** Parameter/return markers that distinguish readonly and scoped references from ordinary CLR byrefs. */
import { encodeCustomAttribute, token } from '@sharpforge/cil';
import { RefKind } from '../../symbols/types.js';
import { methodSignature } from './member-signatures.js';

const IS_READONLY = 'System.Runtime.CompilerServices.IsReadOnlyAttribute';
const REQUIRES_LOCATION = 'System.Runtime.CompilerServices.RequiresLocationAttribute';
const SCOPED_REF = 'System.Runtime.CompilerServices.ScopedRefAttribute';
const REF_SAFETY_RULES = 'System.Runtime.CompilerServices.RefSafetyRulesAttribute';

/** Return parameters need a Param row when the source return is readonly, even without user attributes. */
export function hasReadonlyReturn(method) {
  return method?.refKind === RefKind.RefReadOnly;
}

/** `in` and `ref readonly` have distinct attributes; `out` is already scoped under the C# 11 rules. */
export function writeRefParameterAttributes(attributes, parent, parameter) {
  if (parameter.refKind === RefKind.In) attributes.wellKnown(parent, IS_READONLY);
  if (parameter.refKind === RefKind.RefReadOnlyParameter) attributes.wellKnown(parent, REQUIRES_LOCATION);
  if (parameter.scoped && parameter.refKind !== RefKind.Out) attributes.wellKnown(parent, SCOPED_REF);
}

/** A readonly return carries both this attribute and the signature's modreq(InAttribute). */
export function writeReadonlyReturnAttribute(attributes, parent, method) {
  if (hasReadonlyReturn(method)) attributes.wellKnown(parent, IS_READONLY);
}

/** Select the module's declared ref-safety rules from its actual source language version. */
export function declarationRefSafetyVersion(analysis) {
  return analysis.files.some(file => analysis.versionOf(file.source.uri).number >= 11) ? 11 : null;
}

/** The version describes invocation escape rules, rather than the version of the referenced runtime. */
export function writeRefSafetyRulesAttribute(attributes) {
  const version = attributes.writer.refSafetyRulesVersion;
  if (!version) return;
  const shape = { isStatic: false, returnType: attributes.core.void, parameters: [{ type: attributes.core.int }] };
  const constructor = attributes.builder.member(attributes.frameworkAttribute(REF_SAFETY_RULES), '.ctor', methodSignature(attributes.types, shape));
  attributes.add(token(0, 1), constructor, encodeCustomAttribute(['int'], [version]));
}
