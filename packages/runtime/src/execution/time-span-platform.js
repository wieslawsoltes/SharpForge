import {ManagedFault} from '../heap.js';

const owner = 'System.TimeSpan';
const unhandled = Object.freeze({handled: false});
const minimumTicks = -9_223_372_036_854_775_808n;
const maximumTicks = 9_223_372_036_854_775_807n;
const millisecondLimit = Number(maximumTicks / 10_000n);

function legacyFactory(platform, descriptor, args) {
  const multiplier = descriptor.name === 'FromSeconds' ? 1000 : descriptor.name === 'FromMinutes' ? 60000 : 1;
  const milliseconds = platform.native(args[0]) * multiplier;
  if (!Number.isFinite(milliseconds) || milliseconds < -1e12 || milliseconds > 1e12) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'TimeSpan');
  }
  return platform.make(owner, {TotalMilliseconds: platform.managed(milliseconds, 'double')});
}

function exactTotal(platform, ticks, divisor) {
  if (typeof ticks !== 'bigint' || ticks < minimumTicks || ticks > maximumTicks) {
    throw new ManagedFault('InvalidOperationException', 'Invalid exact TimeSpan tick state');
  }
  const total = Number(ticks) / divisor;
  const value = divisor === 10_000 ? Math.min(millisecondLimit, Math.max(-millisecondLimit, total)) : total;
  return platform.managed(value, 'double');
}

/** Existing TimeSpan APIs retain legacy storage; exact managed tick owners avoid intermediate double rounding. */
export function invokeTimeSpan(platform, descriptor, args) {
  if (descriptor.owner !== owner) return unhandled;
  if (descriptor.name === 'get_Zero') {
    return {handled: true, value: platform.make(owner, {TotalMilliseconds: platform.managed(0, 'double')})};
  }
  if (descriptor.isStatic) return {handled: true, value: legacyFactory(platform, descriptor, args)};
  if (descriptor.name !== 'get_TotalMilliseconds' && descriptor.name !== 'get_TotalSeconds') return unhandled;
  const reference = args[0]?.byref ? platform.vm.dereference(args[0]) : args[0];
  const seconds = descriptor.name === 'get_TotalSeconds';
  if (!reference) return seconds ? {handled: true, value: platform.managed(0, 'double')} : unhandled;
  const record = platform.record(reference);
  const index = platform.propertyIndex(record);
  const tickIndex = index.get('$ticks');
  const ticks = tickIndex === undefined ? null : record.data[tickIndex + 1];
  if (ticks !== null) return {handled: true, value: exactTotal(platform, ticks, seconds ? 10_000_000 : 10_000)};
  const millisecondIndex = index.get('TotalMilliseconds');
  const milliseconds = millisecondIndex === undefined ? null : record.data[millisecondIndex + 1];
  return {handled: true, value: seconds ? platform.managed(platform.native(milliseconds) / 1000, 'double') : milliseconds ?? null};
}
