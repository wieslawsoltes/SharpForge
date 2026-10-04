import {ManagedFault} from '../../heap.js';
import {objectBuiltins} from './objects.js';
import {collectionBuiltins} from './collections.js';
import {serviceBuiltins} from './services.js';

/** Immutable function metadata only; receivers, hosts and results stay with each VM. */
export const namedBuiltinHandlers=Object.freeze(Object.assign(Object.create(null),
  objectBuiltins,collectionBuiltins,serviceBuiltins));

/** Called after the source entry has rooted args and evaluated its first value once. */
export function invokeNamedBuiltin(vm,name,args,value) {
  const handler=namedBuiltinHandlers[name];
  if(handler)return handler(vm,args,value);
  throw new ManagedFault('MissingMethodException',`Intrinsic '${name}' is not implemented`);
}
