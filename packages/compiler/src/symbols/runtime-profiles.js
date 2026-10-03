/** Source-visible symbols for append-only runtime profiles, preserving their builtin identities. */
import {numericTypeName, integerType} from '@sharpforge/bytecode';
import {ConstantValue} from '../constants/constant-value.js';
import {builtinOwners} from './registry-builtins.js';
import {TypeParameterSymbol, ArrayTypeSymbol, Accessibility} from './types.js';
import {MethodSymbol, FieldSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers} from './members.js';

export const runtimeProfile = builtin => builtin.numeric ?? builtin.arrayRuntime ?? builtin.synchronization;
export const runtimeBuiltinOwner = builtin => runtimeProfile(builtin)?.owner ??
  builtinOwners[builtin.name.slice(0, builtin.name.lastIndexOf('.'))];

/** Prefer typed profiles to the old permissive signatures; retain the zero-argument Console overload. */
export function sourceBuiltinCatalog(builtins) {
  const visible = builtins.filter(builtin => !builtin.contract && (!builtin.name.startsWith('$') || runtimeProfile(builtin)));
  const profiles = new Set(visible.filter(runtimeProfile).map(builtin => {
    const descriptor = runtimeProfile(builtin);
    return descriptor.owner + '.' + descriptor.name;
  }));
  return visible.flatMap(builtin => {
    const descriptor = runtimeProfile(builtin);
    if (descriptor) return descriptor.formatType ? [] : [builtin];
    const name = runtimeBuiltinOwner(builtin) + '.' + builtin.name.slice(builtin.name.lastIndexOf('.') + 1);
    if (!profiles.has(name)) return [builtin];
    return builtin.min === 0 && builtin.params.length ? [{...builtin, params: [], max: 0}] : [];
  });
}

function profileType(bridge, name, parameters) {
  if (name.endsWith('[]')) {
    const element = profileType(bridge, name.slice(0, -2), parameters);
    return new ArrayTypeSymbol(element, 1, {baseType: () => bridge.typeFromName('System.Array')});
  }
  if (name.startsWith('!!')) return parameters[Number(name.slice(2))];
  return bridge.typeFromName(name) ?? bridge.objectType;
}

export function runtimeProfileSymbols(bridge, builtin, owner) {
  const descriptor = runtimeProfile(builtin);
  if (!descriptor) return null;
  const generic = Array.from({length: descriptor.genericArity ?? 0}, (_, ordinal) => new TypeParameterSymbol({
    name: 'T' + ordinal, ordinal, hasReferenceTypeConstraint: !!builtin.synchronization,
  }));
  const parameters = descriptor.parameters.map((type, ordinal) => {
    const byref = type.endsWith('&');
    return new ParameterSymbol({name: 'arg' + ordinal, ordinal,
      type: profileType(bridge, byref ? type.slice(0, -1) : type, generic),
      refKind: byref ? descriptor.name === 'TryParse' ? 'out' : 'ref' : 'none'});
  });
  const getter = descriptor.name.startsWith('get_'), constructor = descriptor.name === '.ctor';
  const conversion = ['op_Implicit', 'op_Explicit'].includes(descriptor.name);
  const method = new MethodSymbol({name: descriptor.name, containingSymbol: owner,
    declaredAccessibility: Accessibility.Public, parameters, typeParameters: generic,
    returnType: profileType(bridge, descriptor.returnType, generic),
    methodKind: constructor ? MethodKind.Constructor : getter ? MethodKind.PropertyGet : conversion ? MethodKind.Conversion :
      descriptor.name.startsWith('op_') ? MethodKind.UserDefinedOperator : MethodKind.Ordinary,
    modifiers: descriptor.isStatic ? DeclarationModifiers.Static : 0});
  method.builtin = builtin;
  bridge.builtinSymbols.set(builtin.id, method);
  if (!getter) return [method];
  const property = new PropertySymbol({name: descriptor.name.slice(4), type: method.returnType, getMethod: method,
    containingSymbol: owner, declaredAccessibility: Accessibility.Public, modifiers: method.modifiers});
  return [method, property];
}

/** Constant fields use the semantic constant model; the image adapter later writes exact scalar wire values. */
export function scalarConstantFields(owner, registryName) {
  const type = numericTypeName(registryName), values = {};
  const integer = integerType(type);
  if (integer && !integer.native) {
    const bits = BigInt(integer.bits);
    values.MinValue = ConstantValue.of(type, integer.unsigned ? 0n : -(1n << (bits - 1n)));
    values.MaxValue = ConstantValue.of(type, (1n << (integer.unsigned ? bits : bits - 1n)) - 1n);
  } else if (type === 'float' || type === 'double') {
    const single = type === 'float', max = single ? 3.4028234663852886e38 : Number.MAX_VALUE;
    for (const [name, value] of Object.entries({NaN, PositiveInfinity: Infinity, NegativeInfinity: -Infinity,
      MaxValue: max, MinValue: -max, Epsilon: single ? 2 ** -149 : Number.MIN_VALUE})) values[name] = ConstantValue.of(type, value);
  } else if (type === 'decimal') {
    for (const [name, value] of Object.entries({Zero: '0', One: '1', MinusOne: '-1',
      MaxValue: '79228162514264337593543950335', MinValue: '-79228162514264337593543950335'})) {
      values[name] = ConstantValue.decimal(value);
    }
  }
  return Object.entries(values).map(([name, value]) => new FieldSymbol({name, type: owner, containingSymbol: owner,
    declaredAccessibility: Accessibility.Public, modifiers: DeclarationModifiers.Const, constantValue: {value}}));
}
