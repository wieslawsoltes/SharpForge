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
import { RefReadonlyParameterBinding } from './ref-readonly-parameters.js';
import { InlineArrayBinding } from './inline-arrays.js';
import { CSharp13Rules, CSharp13BodyRules } from './csharp13.js';
import { ReservedTypeNames } from './reserved-type-names.js';

export const modernRules = Object.freeze([CSharp9Rules, CSharp11Rules, CSharp12Rules, CSharp13Rules, ReservedTypeNames]);
export const modernUseRules = Object.freeze([ExperimentalUses, CSharp13BodyRules]);
export const modernBindings = Object.freeze([
  CSharp10Binding,
  CSharp11Binding,
  CollectionExpressionBinding,
  RefReadonlyParameterBinding,
  InlineArrayBinding,
]);
