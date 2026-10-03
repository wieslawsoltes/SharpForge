/**
 * The lowerings of the C# 6, C# 7 and C# 8 epics (SF-A02-E06, E07, E08) as translator mixins, in composition order.
 * The body translator composes them after its own families and the member lowerings, so each one may refine those
 * through `super`.
 */
import { IndexRangeLowering } from './index-range.js';
import { ConditionalAccessLowering } from './conditional-access.js';

export const languageLowerings = Object.freeze([IndexRangeLowering, ConditionalAccessLowering]);
