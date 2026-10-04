import {
  ManagedFault
} from '../heap.js';
import {
  delegateEntries
} from './delegate-invocations.js';
import {
  prepareException
} from './exception-object.js';
export {firstChanceCallbackFailure} from './exception-event-failure.js';

const domainType = 'System.AppDomain';
const domainKey = 'AppDomain.CurrentDomain';
const firstArgs = 'System.Runtime.ExceptionServices.FirstChanceExceptionEventArgs';
const unhandledArgs = 'System.UnhandledExceptionEventArgs';
const phases = Object.freeze({
  firstChance: 'FirstChanceException',
  unhandled: 'UnhandledException'
});

function subscribers(vm, domain, event) {
  const reference = vm.platform.get(domain, '$event:' + event);
  return reference === null ? [] : vm.heap.get(reference).data;
}

function currentDomain(vm) {
  return vm.platform.singleton(domainKey, () => vm.platform.make(domainType));
}

function editSubscribers(vm, domain, event, handler, remove) {
  if (handler === null) return null;
  const list = [...subscribers(vm, domain, event)];
  const incoming = delegateEntries(vm, handler);
  if (remove) {
    for (let index = list.length - incoming.length; index >= 0; index--) {
      if (!incoming.every((entry, offset) => vm.platform.delegateEquals(list[index + offset], entry))) continue;
      list.splice(index, incoming.length);
      break;
    }
  } else list.push(...incoming);
  if (list.length > (vm.options.maxExceptionEventHandlers ?? 1024)) {
    throw new ManagedFault('ExecutionLimitException', 'Exception event subscriber limit exceeded');
  }
  return vm.heap.withRoots([domain, handler, ...list], () => {
    const array = vm.heap.allocate('array', 'object[]', list);
    vm.heap.withRoots([array], () => vm.platform.set(domain, '$event:' + event, array));
    return null;
  });
}

/** Finite framework contract dispatch; handlers remain ordinary managed delegates. */
export function invokeExceptionEvent(vm, descriptor, args) {
  const owner = descriptor.owner;
  if (![domainType, firstArgs, unhandledArgs].includes(owner)) return {
    handled: false
  };
  const self = descriptor.isStatic ? null : args[0];
  const values = descriptor.kind === 'constructor' || descriptor.isStatic ? args : args.slice(1);
  let value;
  if (owner === domainType) {
    if (descriptor.name === 'get_CurrentDomain') value = currentDomain(vm);
    else {
      if (vm.heap.get(self).type !== domainType) throw new ManagedFault('InvalidCastException', 'AppDomain receiver required');
      const event = descriptor.event;
      if (!Object.values(phases).includes(event)) throw new ManagedFault('MissingMethodException', descriptor.name);
      if (values[0] !== null && vm.heap.get(values[0]).type !== descriptor.parameters[0]) {
        throw new ManagedFault('ArgumentException', 'Exception event delegate type mismatch');
      }
      value = editSubscribers(vm, self, event, values[0], descriptor.kind === 'eventRemove');
    }
  } else if (descriptor.kind === 'constructor') {
    if (owner === firstArgs && values[0] === null) throw new ManagedFault('ArgumentNullException', 'exception');
    value = owner === firstArgs ? vm.platform.make(owner, {
        Exception: values[0]
      }) :
      vm.platform.make(owner, {
        ExceptionObject: values[0],
        IsTerminating: values[1]
      });
  } else value = vm.platform.get(self, descriptor.property);
  return {
    handled: true,
    value
  };
}

function startHandler(vm, continuation) {
  return vm.heap.withRoots([continuation.fault.reference, ...continuation.handlers, ...continuation.args], () => {
    while (continuation.index < continuation.handlers.length) {
      const handler = continuation.handlers[continuation.index++];
      const depth = vm.frames.length;
      vm.scheduler.callDelegate(handler, continuation.args);
      if (vm.frames.length === depth) continue; // A registered intrinsic delegate may complete immediately.
      vm.top.exceptionEventContinuation = continuation;
      vm.fault = null;
      vm.state = 'running';
      return true;
    }
    return false;
  });
}

/** Begin a notification on the throwing logical context, preserving the original stack. */
export function beginExceptionEvent(vm, fault, phase) {
  if (fault.exceptionEventResume === phase) {
    delete fault.exceptionEventResume;
    return false;
  }
  const domain = vm.platform.singletons.get(domainKey);
  const context = vm.scheduler.current;
  const deferred = context?.task && context.kind !== 'thread' ||
    ['awaiter-continuation', 'async-state-machine'].includes(context?.kind);
  if (!domain || phase === 'unhandled' && deferred) return false;
  const handlers = [...subscribers(vm, domain, phases[phase])];
  if (!handlers.length) return false;
  prepareException(vm, fault);
  return vm.heap.withRoots([domain, fault.reference, ...handlers], () => {
    const args = phase === 'firstChance' ?
      vm.platform.make(firstArgs, {
        Exception: fault.reference
      }) :
      vm.platform.make(unhandledArgs, {
        ExceptionObject: fault.reference,
        IsTerminating: vm.inspector ? 1 : true
      });
    return startHandler(vm, {
      phase,
      ...(phase === 'firstChance' ? {failurePolicy: vm.options.firstChanceFailurePolicy} : {}),
      fault,
      handlers,
      args: [phase === 'unhandled' ? null : domain, args],
      index: 0
    });
  });
}

/** First-chance notification precedes debugger pause and the managed handler search. */
export function notifyFirstChance(vm, fault) {
  if (fault.exceptionDebuggerResume) {
    delete fault.exceptionDebuggerResume;
    return false;
  }
  fault.phase = 'first-chance';
  if (beginExceptionEvent(vm, fault, 'firstChance')) return true;
  if (!vm.onException?.(fault)) return false;
  vm.pendingFault = fault;
  vm.state = 'paused';
  return true;
}

/** Returning from a notification advances the captured invocation list exactly once. */
export function continueExceptionEvent(vm, frame, continuation = frame.exceptionEventContinuation) {
  if (!continuation) return null;
  if (continuation.index < continuation.handlers.length && startHandler(vm, continuation)) {
    return {
      continued: true
    };
  }
  continuation.fault.exceptionEventResume = continuation.phase;
  return {
    continued: false,
    phase: continuation.phase,
    fault: continuation.fault
  };
}

export function* exceptionEventRoots(frame) {
  const continuation = frame.exceptionEventContinuation;
  if (!continuation) return;
  yield continuation.fault.reference;
  yield* continuation.handlers;
  yield* continuation.args;
}

export function clearExceptionEvents(platform) {
  platform.singletons.delete(domainKey);
}
