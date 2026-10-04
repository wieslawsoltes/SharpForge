import {Builtins, BuiltinMap} from '@sharpforge/bytecode';
import {n} from '../codegen/semantic/node-factory.js';

const arrays = Builtins.filter(builtin => builtin?.arrayRuntime && !builtin.arrayRuntime.internal);
const same = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

export function arrayBuiltin(name, parameters, isStatic = false) {
  const builtin = arrays.find(candidate => candidate.arrayRuntime.name === name &&
    candidate.arrayRuntime.isStatic === isStatic && same(candidate.arrayRuntime.parameters, parameters));
  if (!builtin) throw new Error(`Missing array builtin ${name}(${parameters})`);
  return builtin;
}

export const arrayCall = (name, receiver, args = [], parameters = args.map(value => value.legacyType), result = null) => {
  const builtin = arrayBuiltin(name, parameters, receiver === null);
  return n.frameworkCall({builtin}, receiver, args, result ?? builtin.result);
};

export const memoryCall = (operation, args, result) =>
  n.frameworkCall({builtin: BuiltinMap.get('$memory.' + operation)}, null, args, result);
