import {beginObjectEquals, beginObjectHashCode} from './object-value-operation.js';
import {objectIdentityEquals, objectIdentityHash} from './object-scalar-values.js';
import {objectToString} from './object-method-call.js';

/** Nonvirtual Object base calls retain reference identity; virtual calls honor actual value semantics. */
export const objectValueIntrinsics = Object.freeze({
  objectToString: ({vm, self, isVirtual}) => objectToString(vm, self, isVirtual),
  objectEquals: ({vm, self, parameters, isVirtual}) => isVirtual
    ? beginObjectEquals(vm, self, parameters[0]) : Number(objectIdentityEquals(vm, self, parameters[0])),
  objectHashCode: ({vm, self, isVirtual}) => isVirtual
    ? beginObjectHashCode(vm, self) : objectIdentityHash(vm, self)
});
