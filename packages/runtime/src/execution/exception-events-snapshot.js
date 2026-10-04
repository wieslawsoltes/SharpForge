import {
  ManagedFault,
  isReference
} from '../heap.js';

/** Preflight owned event continuations against saved records, with no live heap reads. */
export function validateExceptionEventsSnapshot(vm, snapshot) {
  const fail = part => {
    throw new TypeError('Invalid snapshot exception events ' + part);
  };
  const same = (left, right) => isReference(left) && isReference(right) && left.h === right.h && left.g === right.g;
  const record = reference => {
    if (!isReference(reference) || reference.heapOwner !== undefined && reference.heapOwner !== vm.heap.handleOwner) fail('owner');
    const value = snapshot.heap.generations[reference.h] === reference.g ? snapshot.heap.records[reference.h] : null;
    if (!value) fail('lifetime');
    return value;
  };
  const property = (value, name) => {
    if (value.kind !== 'host' || !Array.isArray(value.data) || value.data.length % 2) fail('property backing');
    for (let index = 0; index < value.data.length; index += 2)
      if (value.data[index] === name) return value.data[index + 1];
    return null;
  };
  const delegateType = first => first ? 'System.EventHandler`1<System.Runtime.ExceptionServices.FirstChanceExceptionEventArgs>' :
    'System.UnhandledExceptionEventHandler';
  const subscriber = (reference, first) => {
    const value = record(reference);
    if (value.kind !== 'delegate' || value.type !== delegateType(first)) fail('subscriber');
  };
  const domain = new Map(snapshot.platform.singletons).get('AppDomain.CurrentDomain');
  if (domain) {
    const value = record(domain);
    if (value.type !== 'System.AppDomain') fail('domain type');
    for (const name of ['FirstChanceException', 'UnhandledException']) {
      const list = property(value, '$event:' + name);
      if (list === null) continue;
      const array = record(list);
      if (array.kind !== 'array' || !Array.isArray(array.data)) fail('subscriber list');
      if (array.data.length > (vm.options.maxExceptionEventHandlers ?? 1024)) fail('subscriber limit');
      for (const handler of array.data) subscriber(handler, name === 'FirstChanceException');
    }
  }
  const frames = new Set(snapshot.frames);
  for (const [, context] of snapshot.scheduler?.contexts ?? [])
    for (const frame of context.frames) frames.add(frame);
  for (const frame of frames) {
    const event = frame.exceptionEventContinuation;
    if (!event) continue;
    if (!['firstChance', 'unhandled'].includes(event.phase) || !(event.fault instanceof ManagedFault) ||
      typeof event.fault.name !== 'string' || typeof event.fault.message !== 'string') fail('phase or fault');
    if (!Array.isArray(event.handlers) || !Number.isInteger(event.index) || event.index < 1 || event.index > event.handlers.length) fail('cursor');
    if (event.handlers.length > (vm.options.maxExceptionEventHandlers ?? 1024)) fail('captured handler limit');
    const first = event.phase === 'firstChance';
    if (!Array.isArray(event.args) || event.args.length !== 2 ||
      (first ? !same(event.args[0], domain) : event.args[0] !== null)) fail('arguments');
    record(event.fault.reference);
    const args = record(event.args[1]);
    for (const handler of event.handlers) subscriber(handler, first);
    const expected = first ? 'System.Runtime.ExceptionServices.FirstChanceExceptionEventArgs' : 'System.UnhandledExceptionEventArgs';
    if (args.type !== expected || !same(property(args, first ? 'Exception' : 'ExceptionObject'), event.fault.reference)) fail('fault alias');
    if (!first && ![true, 1].includes(property(args, 'IsTerminating'))) fail('termination flag');
  }
}
