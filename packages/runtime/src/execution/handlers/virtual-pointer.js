import {VirtualPointerProfile} from '@sharpforge/cil';
import {ManagedFault} from '../../heap.js';
import {executionCodeState} from '../code-version.js';
import {cachedMetadataToken, verifiedMethod} from '../token-cache.js';
import {requireInstanceCalliReceiver} from '../instance-calli.js';
import {resolveVirtualTarget} from '../inline-cache.js';
import {createMethodPointer} from '../method-pointers.js';

const profiles = new WeakMap();

/** Capture the selected body, never the receiver. Every failure precedes operand removal. */
export function virtualMethodPointer(vm, frame, instruction) {
  const descriptor = cachedMetadataToken(vm, instruction.operand);
  const declaration = descriptor.resolvedToken ?? descriptor.token;
  const receiver = frame.stack.at(-1);
  const actual = requireInstanceCalliReceiver(vm, declaration, receiver, true);
  const epoch = executionCodeState(vm);
  let profile = profiles.get(epoch);
  if (!profile) profiles.set(epoch, profile = new VirtualPointerProfile(vm.inspector, vm.typeSystem.dispatch));
  profile.reachable(declaration);
  if (actual.flags.abstract || !profile.acceptsClass(actual.definitionToken)) {
    throw new ManagedFault('NotSupportedException', 'ldvirtftn requires a concrete nongeneric internal class hierarchy');
  }
  const target = resolveVirtualTarget(vm, frame, instruction, descriptor, receiver);
  if (!profile.contains(declaration, target) || !verifiedMethod(vm, target)) {
    throw new ManagedFault('InvalidProgramException', 'ldvirtftn selected body was not verified');
  }
  requireInstanceCalliReceiver(vm, target, receiver);
  const pointer = createMethodPointer(vm, target);
  frame.stack.pop();
  vm.push(pointer);
}

export const handlers = new Map([['ldvirtftn', virtualMethodPointer]]);
