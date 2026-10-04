/**
 * The lowerings of the C# 3 to C# 12 epics (SF-A02-E05 to E10) as translator mixins, in composition order.
 * The body translator composes them after its own families and the member lowerings, so each one may refine those
 * through `super`.
 */
import { IndexRangeLowering } from './index-range.js';
import { ConditionalAccessLowering } from './conditional-access.js';
import { ThrowExpressionLowering } from './throw-expressions.js';
import { AnonymousTypeLowering } from './anonymous-types.js';
import { UnsignedShiftLowering } from './unsigned-shift.js';
import { DynamicLowering } from './dynamic.js';
import { ComInteropLowering } from './com-interop.js';
import { ExceptionFilterLowering } from './exception-filters.js';
import { InterpolatedStringHandlerLowering } from './interpolated-string-handlers.js';
import { StringElementLowering } from './string-elements.js';
import {FrameworkDelegateTranslation} from './framework-delegates.js';
import {SynchronizationTranslation} from './synchronization.js';

// One entry per line: batches that add a lowering then change different lines.
export const languageLowerings = Object.freeze([
  IndexRangeLowering,
  ConditionalAccessLowering,
  ThrowExpressionLowering,
  AnonymousTypeLowering,
  UnsignedShiftLowering,
  DynamicLowering,
  ComInteropLowering,
  ExceptionFilterLowering,
  InterpolatedStringHandlerLowering,
  StringElementLowering,
  SynchronizationTranslation,
  FrameworkDelegateTranslation,
]);
