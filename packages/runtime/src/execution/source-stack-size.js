import {verifyImage, verifiedSourceStackBound} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';

const caches = new WeakMap();

/** Reuse the verifier's CFG result; source opcodes have no separate runtime effect table. */
export function sourceStackSlots(vm, method) {
  const epoch = executionCodeState(vm);
  let cache = caches.get(epoch);
  if (!cache) caches.set(epoch, cache = new WeakMap());
  const previous = cache.get(method);
  if (previous?.code === method.code && previous.handlers === method.handlers && previous.methods === vm.image.methods) {
    return previous.peak;
  }
  let bound = verifiedSourceStackBound(vm.image, method);
  if (!bound) {
    const errors = verifyImage(vm.image, {stackBounds: true});
    if (errors.length) throw new ManagedFault('InvalidProgramException', 'Bytecode verification failed: ' + errors.join('; '));
    bound = verifiedSourceStackBound(vm.image, method);
  }
  if (!bound) throw new ManagedFault('InvalidProgramException', 'Source frame has no verified method body');
  cache.set(method, {code: method.code, handlers: method.handlers, methods: vm.image.methods, peak: bound.peak});
  return bound.peak;
}
