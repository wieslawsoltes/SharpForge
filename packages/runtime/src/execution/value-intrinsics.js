import {invokeDecimal} from './decimal-intrinsics.js';
import {invokeNullable} from './nullable-intrinsics.js';

const constructors = new Map([
  ['decimal', (vm, definition, descriptor, args) => invokeDecimal(vm, descriptor, args)],
  ['nullable', (vm, definition, descriptor, args) => invokeNullable(vm, definition, args, true)]
]);
const dynamicHandlers = new Map([
  ['nullable', (vm, descriptor, args, definition) => invokeNullable(vm, definition, args).value]
]);
const unhandled = Object.freeze({handled: false});

/** Value constructors produce canonical values; they never allocate class-shaped stand-ins. */
export function constructIntrinsicValue(vm, definition, descriptor, args) {
  const construct = descriptor.name === '.ctor' && constructors.get(definition?.implementation);
  return construct ? construct(vm, definition, descriptor, args) : unhandled;
}

/** Dynamic closed generic contracts share one handler instead of growing a type-instantiation registry. */
export function valueIntrinsicHandler(definition) {
  return dynamicHandlers.get(definition?.implementation);
}
