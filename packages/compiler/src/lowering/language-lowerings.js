/**
 * The lowerings of the C# 6 to C# 12 epics (SF-A02-E06 to E10) as translator mixins, in composition order.
 * The body translator composes them after its own families and the member lowerings, so each one may refine those
 * through `super`.
 */
import { IndexRangeLowering } from './index-range.js';
import { ConditionalAccessLowering } from './conditional-access.js';
import { ThrowExpressionLowering } from './throw-expressions.js';
import { UnsignedShiftLowering } from './unsigned-shift.js';

// One entry per line: batches that add a lowering then change different lines.
export const languageLowerings = Object.freeze([
  IndexRangeLowering,
  ConditionalAccessLowering,
  ThrowExpressionLowering,
  UnsignedShiftLowering,
]);
