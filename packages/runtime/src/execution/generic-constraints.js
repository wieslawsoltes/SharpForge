import {decodeCoded, methodGenericParameters, substituteCallType, primitiveSizes, isByrefStructForwarder} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {isAggregateType, requireValueStorage} from './value-types.js';

const forwarders = new WeakMap();

/** Canonical method admission is derived from the code epoch, never snapshot or heap state. */
export function requireGenericStructArgument(vm, owner, type) {
  const epoch = executionCodeState(vm);
  let methods = forwarders.get(epoch);
  if (!methods) forwarders.set(epoch, methods = new Map());
  let admitted = methods.get(owner);
  if (admitted === undefined) {
    admitted = isByrefStructForwarder(vm.inspector, owner);
    methods.set(owner, admitted);
  }
  if (!admitted || !isAggregateType(type) || type.flags.nullable || type.genericArity || type.typeArguments.length) {
    throw new ManagedFault('NotSupportedException',
      'Struct generic arguments require a static Apply<T>(ref T, ...) constrained interface forwarder');
  }
  requireValueStorage(vm, type);
}

function invalid(message) {
  throw new ManagedFault('InvalidProgramException', message);
}

function supportsConstructor(vm, type) {
  if (type.flags.valueType || type.name === 'System.Object') return true;
  if (type.flags.abstract) return false;
  const definition = vm.typeSystem.types.get(type.definitionToken);
  return definition?.methods.some(method => method.name === '.ctor' && (method.flags & 7) === 6 &&
    vm.inspector.signature(method.token).parameters.length === 0) ?? false;
}

/** Validate ECMA generic constraints against closed MethodTable identities. */
export function validateGenericArguments(vm, owner, arguments_, context) {
  const {typeArguments, methodArguments, arity = null} = context;
  const parameters = methodGenericParameters(vm.inspector, owner);
  if (arguments_.length !== parameters.length || arity !== null && parameters.length !== arity ||
      parameters.some((parameter, index) => parameter.index !== index)) {
    invalid('Generic parameter metadata does not match instantiation arity');
  }
  for (const parameter of parameters) {
    const type = vm.typeSystem.table(arguments_[parameter.index]);
    if (type.containsGenericParameters || type.flags.byRef || type.flags.pointer || type.name === 'System.Void') {
      invalid('Generic arguments must be closed managed types');
    }
    if (type.flags.external) {
      throw new ManagedFault('NotSupportedException', 'Unregistered external generic argument is inspection-only');
    }
    if (type.flags.valueType && !type.flags.primitive && !type.flags.enum && !primitiveSizes[type.name]) {
      requireGenericStructArgument(vm, owner, type);
    }
    const badReference = parameter.flags & 4 && type.flags.valueType;
    const badValue = parameter.flags & 8 && (!type.flags.valueType || type.flags.nullable);
    if (badReference || badValue || parameter.flags & 16 && !supportsConstructor(vm, type)) {
      throw new ManagedFault('ArgumentException', 'Generic constraint violation');
    }
    for (const row of vm.inspector.metadata.rows[44] ?? []) {
      if (row[0] !== parameter.row) continue;
      const declared = vm.inspector.metadata.typeName(decodeCoded('TypeDefOrRef', row[1]));
      const target = substituteCallType(declared, typeArguments, methodArguments);
      if (!vm.typeSystem.castCache.isAssignableFrom(vm.typeSystem.table(target), type)) {
        throw new ManagedFault('ArgumentException', 'Generic type constraint violation');
      }
    }
  }
}
