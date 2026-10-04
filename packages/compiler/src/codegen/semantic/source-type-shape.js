import {sourceInterfaceShape} from './interface-shape.js';
import {
  TypeKind
} from '../../symbols/types.js';
import {
  n
} from './node-factory.js';
import {
  managedDereference
} from '../memory-nodes.js';

/** Closed source structs use ordinary managed value storage in every execution route. */
export function sourceTypeShape(symbol) {
  return symbol.typeKind === TypeKind.Struct ? {
    valueType: true,
    base: 'System.ValueType'
  } : sourceInterfaceShape(symbol);
}

/** Value-type instance methods receive an address; expressions read the value at that address. */
export function sourceThis(owner) {
  return owner.valueType ? managedDereference(n.thisReference(owner.name + '&')) : n.thisReference(owner.name);
}

export function isSourceValueType(program, name) {
  return !!program.typesByName?.get(name)?.valueType;
}
