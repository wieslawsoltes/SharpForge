/**
 * Binder rules of the C# 7 to C# 12 epics (SF-A02-E07 to SF-A02-E10) that refine several construct families at once.
 * They are class mixins like the families of ./body-binder.js and are applied after them, in this order, so each
 * rule sees every family and the rules before it.
 */
import { ExpressionVariableBinding } from './expression-variables.js';
import { CSharp70Binding } from './csharp70.js';
import { CSharp7xBinding } from './csharp7x.js';
import { CSharp8Binding } from './csharp8.js';
import { IndexRangeBinding } from './index-range.js';
import { modernBindings } from './modern-rules.js';

export const languageRules = [CSharp70Binding, CSharp7xBinding, ExpressionVariableBinding, IndexRangeBinding, CSharp8Binding, ...modernBindings];
