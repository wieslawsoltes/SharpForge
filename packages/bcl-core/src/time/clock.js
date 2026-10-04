import {fail} from '../host.js';
import {invokeStopwatchClock} from './clock-callback.js';

/** Unix .NET Stopwatch profile: one counter tick is one nanosecond. */
export const stopwatchFrequency = 1_000_000_000n;
export const maximumTimestamp = 9_223_372_036_854_775_807n;
export const stopwatchCallCanceled = Object.freeze({stopwatchCallCanceled: true});

const reentry = 'BCLSW0006: Stopwatch clock callbacks cannot reenter an active operation';

/** @typedef {{stopwatchClock?: () => bigint}} StopwatchClockOptions */

function browserClock(platform) {
  const performance = globalThis.performance;
  if (typeof performance?.now !== 'function') {
    fail(platform, 'PlatformNotSupportedException', 'BCLSW0002: A monotonic performance clock is required');
  }
  const read = performance.now.bind(performance);
  return () => {
    const milliseconds = read();
    if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0 ||
        milliseconds > Number(maximumTimestamp) / 1_000_000) return null;
    const whole = Math.trunc(milliseconds);
    return BigInt(whole) * 1_000_000n + BigInt(Math.trunc((milliseconds - whole) * 1_000_000));
  };
}

function clockState(platform) {
  if (platform.stopwatchClockState) return platform.stopwatchClockState;
  const supplied = platform.options.stopwatchClock;
  if (supplied !== undefined && typeof supplied !== 'function') {
    fail(platform, 'ArgumentException', 'BCLSW0001: stopwatchClock must be a synchronous function returning bigint nanoseconds');
  }
  const state = {read: supplied ?? browserClock(platform), previous: null, reading: false, reentered: false, reference: null};
  platform.stopwatchClockState = state;
  return state;
}

/** Read bounded exact ticks. Host clock state belongs to the platform and does not rewind with managed snapshots. */
export function readStopwatchTimestamp(platform, reference = null) {
  const state = clockState(platform);
  if (state.reading) {
    state.reentered = true;
    fail(platform, 'InvalidOperationException', reentry);
  }
  let timestamp;
  state.reading = true;
  state.reentered = false;
  state.reference = reference;
  try {
    timestamp = invokeStopwatchClock(platform, state);
  } catch {
    if (platform.bclHost.isExecutionStopped?.(platform) === true) throw stopwatchCallCanceled;
    fail(platform, 'InvalidOperationException', state.reentered ? reentry : 'BCLSW0003: Stopwatch clock callback failed');
  } finally {
    state.reading = false;
    state.reference = null;
  }
  if (platform.bclHost.isExecutionStopped?.(platform) === true) throw stopwatchCallCanceled;
  if (state.reentered) fail(platform, 'InvalidOperationException', reentry);
  if (typeof timestamp !== 'bigint' || timestamp < 0n || timestamp > maximumTimestamp) {
    fail(platform, 'InvalidOperationException', 'BCLSW0004: Stopwatch clock must return nonnegative Int64 nanoseconds');
  }
  if (state.previous !== null && timestamp < state.previous) {
    fail(platform, 'InvalidOperationException', 'BCLSW0005: Stopwatch clock moved backwards');
  }
  state.previous = timestamp;
  return timestamp;
}

/** Reset does not sample a clock, but cannot overwrite the state an active clock operation captured. */
export function rejectStopwatchResetDuringClock(platform, reference) {
  const active = platform.stopwatchClockState;
  if (active?.reading && active.reference?.h === reference.h && active.reference?.g === reference.g) {
    active.reentered = true;
    fail(platform, 'InvalidOperationException', reentry);
  }
}
