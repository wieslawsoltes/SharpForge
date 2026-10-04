import {nullableElementType, nullableScalarTypes} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {defaults, storage as numericStorage} from './numeric-ops.js';
import {nullableRecord, materializeNullableRecord} from './nullable-records.js';
import {nullableValue as genericNullableValue, copyNullable} from './nullable-value.js';
import {invokeNullable as invokeGenericNullable} from './nullable-intrinsics.js';

const brand = Symbol('SharpForge.NullableScalar');
const scalars = new Set(nullableScalarTypes);
const operations = new Map([['.ctor', 'construct'], ['get_HasValue', 'hasValue'],
  ['get_Value', 'value'], ['GetValueOrDefault', 'default'], ['ToString', 'text']]);
const numbers = Object.freeze({fault: (type, message) => new ManagedFault(type, message)});

/** An immutable CLI value; neither absent nor present-zero is represented by a JavaScript truthiness test. */
export function nullableValue(vm, type, hasValue, value = undefined, numericContext = numbers) {
  const element = nullableElementType(type);
  if (!element) throw new ManagedFault('NotSupportedException', 'Nullable storage requires an approved closed value type');
  if (vm.typeSystem && scalars.has(element)) return genericNullableValue(vm, type, value, hasValue);
  const record = nullableRecord(vm, element, value, hasValue);
  return Object.freeze({[brand]: true, nullable: element, hasValue: !!hasValue,
    value: record ?? (hasValue ? numericStorage(value, element, numericContext) : defaults(element))});
}

export function requireNullable(vm, value, type) {
  const element = nullableElementType(type);
  if (value?.byref) value = vm.dereference(value);
  if (vm.typeSystem && scalars.has(element)) return copyNullable(vm, value, type);
  if (!element || value?.[brand] !== true || value.nullable !== element) {
    throw new ManagedFault('InvalidProgramException', 'Nullable scalar storage type mismatch');
  }
  return value;
}

export function invokeNullable(vm, descriptor, self, parameters) {
  const type = descriptor.owner;
  const element = nullableElementType(type);
  if (vm.typeSystem && scalars.has(element)) {
    return invokeGenericNullable(vm, {owner: type, element, operation: operations.get(descriptor.name)}, [self, ...parameters]).value;
  }
  if (descriptor.name === '.ctor') {
    if (!self?.byref) throw new ManagedFault('InvalidProgramException', 'Nullable constructor requires a managed address');
    vm.dereference(self, true, nullableValue(vm, type, true, parameters[0]));
    return null;
  }
  const value = requireNullable(vm, self, type);
  if (descriptor.name === 'ToString') {
    return vm.heap.string(value.hasValue ? vm.format(materializeNullableRecord(vm, value.value), element) : '');
  }
  if (descriptor.name === 'get_HasValue') return value.hasValue ? 1 : 0;
  if (descriptor.name === 'get_Value' && !value.hasValue) {
    throw new ManagedFault('InvalidOperationException', 'Nullable object must have a value');
  }
  return value.hasValue ? materializeNullableRecord(vm, value.value) : parameters.length ? parameters[0]
    : materializeNullableRecord(vm, value.value);
}

/** CLI callers see a real Nullable<T> value; source/host adapters exchange its nullable underlying value. */
export function invokeNullableFramework(vm, contract, args) {
  // Registered struct getters receive the same value carrier as source calls, before any subsystem intercepts them.
  if (!contract.isStatic && contract.kind !== 'constructor' && args[0]?.byref) {
    args = [vm.dereference(args[0]), ...args.slice(1)];
  }
  const nullableResult = nullableElementType(contract.result);
  if (!nullableResult && !contract.parameters.some(type => nullableElementType(type))) return vm.platform.invoke(contract, args);
  return vm.heap.withRoots(args, () => {
    const projected = projectNullableArguments(vm, contract, args);
    const values = projected.map(value => {
      const result = materializeNullableRecord(vm, value);
      vm.heap.pins.push(result);
      return result;
    });
    const result = vm.platform.invoke(contract, values);
    return nullableResult ? nullableValue(vm, contract.result, result !== null, result) : result;
  });
}

/** Framework adapters receive the scalar/null projection at their ABI boundary, after CLI presence checks. */
export function projectNullableArguments(vm, contract, args) {
  const offset = !contract.isStatic && contract.kind !== 'constructor' ? 1 : 0;
  if (!contract.parameters.some(type => nullableElementType(type))) return args;
  return args.map((value, index) => {
    const type = contract.parameters[index - offset];
    if (!nullableElementType(type)) return value;
    const nullable = requireNullable(vm, value, type);
    return nullable.hasValue ? nullable.value : null;
  });
}
