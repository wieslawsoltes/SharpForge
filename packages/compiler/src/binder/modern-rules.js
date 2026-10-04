/**
 * The rules of the C# 9 to 12 epics (SF-A02-E09, SF-A02-E10), registered once for both places that compose them.
 *
 *   modernRules    - class mixins of the semantic analysis, in composition order; each runs once the attributes are
 *                    bound (../semantic-analysis.js).
 *   modernUseRules - composed after the phase that records the uses of symbols (binder/obsolete.js).
 *   modernBindings - class mixins of the body binder, applied after its construct families (./language-rules.js).
 */
import { CSharp9Rules } from './csharp9.js';
import { CSharp10Binding } from './csharp10.js';
import { CSharp11Rules, CSharp11Binding } from './csharp11.js';
import { CSharp12Rules, ExperimentalUses } from './csharp12.js';
import { CollectionExpressionBinding } from './collection-expressions.js';
import { CollectionBuilderBinding } from './collection-builders.js';
import { Utf8StringBinding } from './utf8-strings.js';
import { RefReadonlyParameterBinding } from './ref-readonly-parameters.js';
import { InlineArrayBinding } from './inline-arrays.js';
import { FunctionPointerBinding, FunctionPointerRules } from './function-pointers.js';
import { CSharp13Rules, CSharp13BodyRules } from './csharp13.js';
import { CSharp14Rules } from './csharp14.js';
import { PreviewFeatureRules } from './preview-features.js';
import { ReservedTypeNames } from './reserved-type-names.js';
import { MemorySafetyRules, MemorySafetyUses } from './memory-safety.js';
import { InterpolatedStringHandlerBinding } from './interpolated-string-handlers.js';

export const modernRules = Object.freeze([
  CSharp9Rules,
  FunctionPointerRules,
  CSharp11Rules,
  CSharp12Rules,
  CSharp13Rules,
  ReservedTypeNames,
  CSharp14Rules,
  PreviewFeatureRules,
  MemorySafetyRules,
]);
export const modernUseRules = Object.freeze([ExperimentalUses, CSharp13BodyRules, MemorySafetyUses]);
export const modernBindings = Object.freeze([
  CSharp10Binding,
  InterpolatedStringHandlerBinding,
  CSharp11Binding,
  Utf8StringBinding,
  CollectionExpressionBinding,
  CollectionBuilderBinding,
  RefReadonlyParameterBinding,
  InlineArrayBinding,
  FunctionPointerBinding,
]);
