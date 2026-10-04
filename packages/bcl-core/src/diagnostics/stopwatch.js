import {fail} from '../host.js';
import {readStopwatchTimestamp, rejectStopwatchResetDuringClock,
  stopwatchFrequency, maximumTimestamp, stopwatchCallCanceled} from '../time/clock.js';
import {formatTimeSpanTicks} from '../time/time-span-format.js';

const owner = 'System.Diagnostics.Stopwatch';
const minimumTimestamp = -maximumTimestamp - 1n;
const spanTickFrequency = 10_000_000 / Number(stopwatchFrequency);

function contracts({define, ctor, prop, member}) {
  define(owner, {kind: 'bcl14', family: 'stopwatch', fields: {
    Frequency: {type: 'long', isStatic: true, readOnly: true,
      value: {scalar: 'long', value: stopwatchFrequency.toString()}, addressable: false,
      assemblies: ['System.Runtime', 'System.Private.CoreLib']},
    IsHighResolution: {type: 'bool', isStatic: true, readOnly: true, value: true, addressable: false,
      assemblies: ['System.Runtime', 'System.Private.CoreLib']}
  }});
  ctor(owner);
  member(owner, 'StartNew', [], owner, {isStatic: true});
  for (const name of ['Start', 'Stop', 'Reset', 'Restart']) member(owner, name, [], 'void');
  prop(owner, 'IsRunning', 'bool', false, true);
  prop(owner, 'Elapsed', 'System.TimeSpan', null, true);
  prop(owner, 'ElapsedMilliseconds', 'long', null, true);
  prop(owner, 'ElapsedTicks', 'long', null, true);
  member(owner, 'GetTimestamp', [], 'long', {isStatic: true});
  member(owner, 'GetElapsedTime', ['long'], 'System.TimeSpan', {isStatic: true});
  member(owner, 'GetElapsedTime', ['long', 'long'], 'System.TimeSpan', {isStatic: true});
  member(owner, 'ToString', [], 'string', {objectToStringOverride: true});
}

function create(platform) {
  return platform.make(owner, {'$elapsed': 0n, '$started': 0n, '$running': false});
}

function state(platform, reference) {
  const record = platform.record(reference);
  if (record.type !== owner) fail(platform, 'InvalidCastException', 'A Stopwatch receiver is required');
  return record.data;
}

function update(platform, reference, elapsed, started, running) {
  const previous = state(platform, reference);
  if (previous[1] === elapsed && previous[3] === started && previous[5] === running) return;
  const data = ['$elapsed', elapsed, '$started', started, '$running', running];
  platform.heap.replaceData(reference, data);
  // Observers see a complete transition, including when they collect or throw.
  for (let index = 1; index < data.length; index += 2) {
    if (previous[index] !== data[index]) platform.vm.notifyWrite?.({kind: 'field', handle: reference.h,
      generation: reference.g, index, property: data[index - 1], oldValue: previous[index], value: data[index]});
  }
}

function elapsedTicks(platform, reference) {
  const data = state(platform, reference);
  return data[5] ? BigInt.asIntN(64, data[1] + readStopwatchTimestamp(platform, reference) - data[3]) : data[1];
}

function spanTicks(counterTicks) {
  // CoreCLR multiplies the Int64 counter by a double, then truncates; exact integer division differs above 2^53.
  return BigInt(Math.trunc(Number(counterTicks) * spanTickFrequency));
}

function timeSpan(platform, ticks) {
  return platform.make('System.TimeSpan', {'$ticks': ticks, TotalMilliseconds: platform.managed(Number(ticks) / 10_000, 'double')});
}

function long(platform, value) {
  const native = platform.native(value);
  if (typeof native !== 'bigint' || native < minimumTimestamp || native > maximumTimestamp) {
    fail(platform, 'ArgumentOutOfRangeException', 'A signed Int64 timestamp is required');
  }
  return native;
}

function invokeStatic(platform, descriptor, args) {
  switch (descriptor.name) {
    case 'GetTimestamp': return readStopwatchTimestamp(platform);
    case 'StartNew': {
      const reference = create(platform);
      return platform.heap.withRoots([reference], () => {
        update(platform, reference, 0n, readStopwatchTimestamp(platform, reference), true);
        return reference;
      });
    }
    case 'GetElapsedTime': {
      const started = long(platform, args[0]);
      const ended = args.length === 1 ? readStopwatchTimestamp(platform) : long(platform, args[1]);
      return timeSpan(platform, spanTicks(BigInt.asIntN(64, ended - started)));
    }
    default: fail(platform, 'MissingMethodException', descriptor.name);
  }
}

function invokeInstance(platform, descriptor, reference) {
  const data = state(platform, reference);
  switch (descriptor.name) {
    case 'Start':
      if (!data[5]) update(platform, reference, data[1], readStopwatchTimestamp(platform, reference), true);
      return null;
    case 'Stop':
      if (data[5]) update(platform, reference, elapsedTicks(platform, reference), data[3], false);
      return null;
    case 'Reset':
      rejectStopwatchResetDuringClock(platform, reference);
      return update(platform, reference, 0n, 0n, false) ?? null;
    case 'Restart': return update(platform, reference, 0n, readStopwatchTimestamp(platform, reference), true) ?? null;
    case 'get_IsRunning': return platform.managed(data[5], 'bool');
    case 'get_ElapsedTicks': return elapsedTicks(platform, reference);
    case 'get_ElapsedMilliseconds': return spanTicks(elapsedTicks(platform, reference)) / 10_000n;
    case 'get_Elapsed': return timeSpan(platform, spanTicks(elapsedTicks(platform, reference)));
    case 'ToString': return platform.managed(formatTimeSpanTicks(spanTicks(elapsedTicks(platform, reference))), 'string');
    default: fail(platform, 'MissingMethodException', descriptor.name);
  }
}

function invoke(platform, descriptor, args, type = platform.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl14' || type.family !== 'stopwatch') return {handled: false};
  try {
    const value = descriptor.kind === 'constructor' ? create(platform)
      : descriptor.isStatic ? invokeStatic(platform, descriptor, args) : invokeInstance(platform, descriptor, args[0]);
    return {handled: true, value};
  } catch (error) {
    if (error === stopwatchCallCanceled) return {handled: true, value: null};
    throw error;
  }
}

/** Managed state and explicit per-platform clocks implement the complete Stopwatch member family. */
export const stopwatchModule = Object.freeze({name: 'stopwatch', families: ['stopwatch'], contracts, invoke});
