/**
 * The lowerings of the C# 3 to C# 8 epics (SF-A02-E05 to E08) as translator mixins, in composition order.
 * The body translator composes them after its own families and the member lowerings, so each one may refine those
 * through `super`.
 */
import { IndexRangeLowering } from './index-range.js';
import { ConditionalAccessLowering } from './conditional-access.js';
import { AnonymousTypeLowering } from './anonymous-types.js';

export const languageLowerings = Object.freeze([IndexRangeLowering, ConditionalAccessLowering, AnonymousTypeLowering]);
