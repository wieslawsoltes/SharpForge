/**
 * Binder rules of the C# 7 to C# 12 epics (SF-A02-E07 to SF-A02-E10) that refine several construct families at once.
 * They are class mixins like the families of ./body-binder.js and are applied after them, in this order, so each
 * rule sees every family and the rules before it.
 */
import { ExpressionVariableBinding } from './expression-variables.js';
import { CSharp8Binding } from './csharp8.js';
import { IndexRangeBinding } from './index-range.js';
import { CSharp10Binding } from './csharp10.js';

export const languageRules = [ExpressionVariableBinding, IndexRangeBinding, CSharp8Binding, CSharp10Binding];
