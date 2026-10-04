import {
  createException
} from './exception-object.js';
import {
  exceptionConstructor,
  exceptionIntrinsic
} from './exception-intrinsics.js';

/** Adapt the source stack ABI to the same constructor/member implementations used by direct CIL. */
export function sourceExceptionBuiltin(vm, profile, args) {
  return vm.heap.withRoots(args, () => {
    const descriptor = {
      owner: profile.owner,
      name: profile.name,
      signature: profile
    };
    if (profile.name === '.ctor') {
      const reference = createException(vm, profile.owner);
      return vm.heap.withRoots([reference], () => {
        exceptionConstructor(vm, descriptor, reference, args);
        return reference;
      });
    }
    const receiver = profile.isStatic ? null : args[0];
    const parameters = profile.isStatic ? args : args.slice(1);
    return exceptionIntrinsic(vm, descriptor, receiver, parameters);
  });
}
