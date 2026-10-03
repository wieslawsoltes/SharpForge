/**
 * The lowerings of the C# 7 and C# 8 epics (SF-A02-E07, SF-A02-E08) as translator mixins, in composition order.
 * The body translator composes them after its own families and the member lowerings, so each one may refine those
 * through `super`.
 */
import { IndexRangeLowering } from './index-range.js';
import { ThrowExpressionLowering } from './throw-expressions.js';

export const languageLowerings = Object.freeze([IndexRangeLowering, ThrowExpressionLowering]);
