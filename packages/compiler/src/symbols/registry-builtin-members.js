import {appendRegistryBuiltin} from './registry-builtin-binding.js';
import {builtinMemberShape, builtinParameterType} from '@sharpforge/bytecode';
import {ArrayTypeSymbol, TypeParameterSymbol} from './types.js';
import {MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers} from './members.js';

function genericType(bridge, name, parameters) {
  if (name.endsWith('[]')) return new ArrayTypeSymbol(genericType(bridge, name.slice(0, -2), parameters), 1,
    {baseType: () => bridge.typeFromName('System.Array')});
  if (/^!!\d+$/.test(name)) return parameters[Number(name.slice(2))];
  return bridge.typeFromName(name) ?? bridge.objectType;
}

/** Declare byref and generic builtin signatures before argument binding, retaining exact source parameter types. */
export function appendRegistryBuiltins(bridge, registryName, members, pub) {
  for (const builtin of bridge.builtinsByOwner.get(registryName) ?? []) {
    const {name, instance, property} = builtinMemberShape(builtin);
    const result = builtin.result === 'numeric' ? 'double' : builtin.result;
    const typeParameters = Array.from({length: builtin.arrayRuntime?.genericArity ?? builtin.synchronization?.genericArity ?? 0},
      (_, ordinal) => new TypeParameterSymbol({name: 'T' + ordinal, ordinal,
        hasReferenceTypeConstraint: !!builtin.synchronization}));
    const params = instance ? builtin.params.slice(1) : builtin.params;
    const required = builtin.min - (instance ? 1 : 0);
    const parameters = params.map((type, ordinal) => {
      const byref = type.endsWith('&'), name = byref ? type.slice(0, -1) : type;
      return new ParameterSymbol({name: builtin.parameterNames?.[ordinal] ?? 'arg' + ordinal,
        type: genericType(bridge, builtinParameterType(builtin, name), typeParameters), ordinal,
        refKind: byref ? 'ref' : 'none',
        ...(ordinal >= required ? {explicitDefaultValue: {value: null}} : {})});
    });
    const returnType = genericType(bridge, result, typeParameters);
    const modifiers = instance ? 0 : DeclarationModifiers.Static;
    let symbol;
    if (name === 'new') symbol = new MethodSymbol({...pub, name: '.ctor', methodKind: MethodKind.Constructor,
      returnType: bridge.typeFromName('void'), parameters});
    else if (property) {
      const getter = new MethodSymbol({...pub, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType, modifiers});
      getter.builtin = builtin;
      symbol = new PropertySymbol({...pub, name, type: returnType, getMethod: getter, modifiers});
    } else symbol = new MethodSymbol({...pub, name, returnType, parameters, typeParameters, modifiers});
    appendRegistryBuiltin(bridge,members,symbol,builtin);
  }
}
