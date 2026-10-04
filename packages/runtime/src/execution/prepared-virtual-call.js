import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {callDescriptor, selectedCallOwner} from './generic-calls.js';
import {resolveVirtualCallEntry} from './inline-cache.js';
import {verifiedMethod} from './token-cache.js';
import {framePool} from './frame-pool.js';
import {preparedCilTarget, enterPreparedCilFrame} from './prepared-cil-frame.js';
import {hasCanonicalCilCall} from './call-entry-guard.js';

const caches = new WeakMap();

function build(vm, caller, instruction) {
  const descriptor = callDescriptor(vm, instruction.operand, caller);
  const target = descriptor.resolvedToken ?? descriptor.token;
  const method = vm.inspector.methods.get(target), signature = descriptor.signature;
  if (!method || !(method.flags & 0x40) || method.flags & 0x10 || signature.isStatic || signature.callingConvention ||
      signature.explicitThis || signature.sentinel != null || signature.genericArity || descriptor.methodArguments?.length ||
      descriptor.ownerInstance || descriptor.genericIdentity) return null;
  const owner = vm.typeSystem.table(method.ownerToken);
  if (owner.flags.valueType || owner.flags.interface || owner.genericArity || owner.containsGenericParameters) return null;
  return {descriptor, count: signature.parameters.length + 1, targets: new WeakMap()};
}

function planFor(vm, caller, instruction) {
  const epoch = executionCodeState(vm);
  let methods = caches.get(epoch);
  if (!methods) caches.set(epoch, methods = new WeakMap());
  let cached = methods.get(caller.method);
  if (!cached || cached.instructions !== caller.method.instructions) {
    methods.set(caller.method, cached = {instructions: caller.method.instructions, sites: new Map()});
  }
  let site = cached.sites.get(instruction.offset);
  if (!site || site.operand !== instruction.operand) {
    site = {operand: instruction.operand, plan: build(vm, caller, instruction)};
    cached.sites.set(instruction.offset, site);
  }
  return site.plan;
}

/** Warm class callvirt sites reuse exact call setup while preserving normal frame admission and instruction boundaries. */
export function tryPreparedVirtualCall(vm, caller, instruction) {
  if (instruction.name !== 'callvirt' || vm.options.inlineCaches === false ||
      caller.method.instructions[caller.pc - 2]?.name.endsWith('.')) return false;
  const plan = planFor(vm, caller, instruction);
  if (!plan) return false;
  const descriptor = plan.descriptor;
  if (vm.ensureInitialized(descriptor.ownerToken, 'instance-method', null)) { caller.pc--; return true; }
  const stack = caller.stack, start = stack.length - plan.count;
  if (start < 0) throw new TypeError('Invalid call argument count');
  try {
    const receiver = stack[start];
    if (receiver === null) throw new ManagedFault('NullReferenceException', 'Null virtual receiver');
    const entry = resolveVirtualCallEntry(vm, caller, instruction, descriptor, receiver);
    if (!verifiedMethod(vm, entry.target)) {
      throw new ManagedFault('NotSupportedException', 'Unverified virtual override; select its method directly');
    }
    let target = plan.targets.get(entry);
    const method = vm.inspector.getMethod(entry.target);
    if (!target || target.method !== method || target.signature !== method.signature ||
        target.parameters !== method.signature.parameters || target.locals !== method.locals ||
        target.parameterCount !== method.signature.parameters.length || target.localCount !== method.locals.length ||
        target.maxStack !== method.maxStack) {
      const extra = Object.freeze({genericIdentity: selectedCallOwner(vm, entry.target, receiver, null),
        methodArguments: descriptor.methodArguments});
      target = {extra, method, signature: method.signature, parameters: method.signature.parameters,
        locals: method.locals, parameterCount: method.signature.parameters.length, localCount: method.locals.length,
        maxStack: method.maxStack, prepared: preparedCilTarget(vm, entry.target, extra)};
      plan.targets.set(entry, target);
    }
    if (target.prepared && hasCanonicalCilCall(vm)) enterPreparedCilFrame(vm, target.prepared, stack, start, plan.count, target.extra);
    else {
      const pool = framePool(vm), args = pool.arguments(stack, plan.count);
      try { vm.heap.withRoots(args, () => vm.call(entry.target, args, target.extra)); }
      finally { pool.releaseArguments(args); }
    }
  } finally { stack.length = start; }
  return true;
}
