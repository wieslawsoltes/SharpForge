import {MethodSymbol, ParameterSymbol, PropertySymbol, FieldSymbol, DeclarationModifiers} from './members.js';
import {RefKind} from './types.js';
import {isParamsParameter} from './registry-params.js';
import {ConstantValue} from '../constants/constant-value.js';

/** GC enums opt into typed semantic constants while released registry symbol values keep their shape. */
export function registryEnumMembers(entry, owner, accessibility) {
  if (entry?.kind !== 'enum') return [];
  return Object.entries(entry.values ?? {}).map(([name, value]) => new FieldSymbol({
    ...accessibility, name, type: owner, modifiers: DeclarationModifiers.Const,
    constantValue: {value: entry.gcEnum ? ConstantValue.enum(owner, value) : value}
  }));
}

/** CLI byref suffixes describe transport; symbols expose the referent type and ref kind separately. */
export function registryReferent(typeName) {
  return typeName.endsWith('&') ? typeName.slice(0, -1) : typeName;
}

export function registryRefKind(typeName, declaredKind) {
  return declaredKind ?? (typeName.endsWith('&') ? RefKind.Ref : RefKind.None);
}

export function registryParameter(bridge, typeName, index, declaredKind, defaultValue) {
  const isParams = typeof declaredKind === 'boolean' && declaredKind;
  return new ParameterSymbol({name: 'arg' + index, ordinal: index,
    type: bridge.typeFromName(registryReferent(typeName)) ?? bridge.objectType,
    refKind: registryRefKind(typeName, typeof declaredKind === 'boolean' ? undefined : declaredKind), isParams,
    ...(defaultValue ? {explicitDefaultValue: defaultValue} : {})});
}

function contractParameter(bridge, contract, index) {
  const parameter = registryParameter(bridge, contract.parameters[index], index,
    contract.parameterRefKinds?.[index],
    index < (contract.parameterDefaults?.length ?? 0) ? {value: contract.parameterDefaults[index]} : null);
  parameter.isParams = isParamsParameter(contract, index);
  return parameter;
}

/** Preserve the existing registry method shape, adding opt-in CLI ref/out/readonly metadata. */
export function registryMethod(bridge, contract, owner, kind, accessibility) {
  return new MethodSymbol({
    ...accessibility, containingSymbol: owner, name: contract.name, methodKind: kind,
    declaredAccessibility: contract.accessibility ?? accessibility.declaredAccessibility,
    returnType: contract.kind === 'constructor' ? bridge.byName.get('void') :
      bridge.typeFromName(registryReferent(contract.result)) ?? bridge.objectType,
    refKind: registryRefKind(contract.result, contract.returnRefKind),
    parameters: contract.parameters.map((name, index) => contractParameter(bridge, contract, index)),
    modifiers: (contract.isStatic ? DeclarationModifiers.Static : 0) |
      (contract.isVirtual ? DeclarationModifiers.Virtual : 0) |
      (contract.isAbstract ? DeclarationModifiers.Abstract : 0)
  });
}


/** Property override/accessibility metadata follows its registered accessor. */
export function registryProperty(name, accessors, accessibility) {
  const getter = accessors.get;
  const setter = accessors.set;
  const accessor = getter ?? setter;
  return new PropertySymbol({...accessibility, name, type: getter?.returnType ?? setter.parameters[0].type,
    refKind: getter?.refKind, getMethod: getter ?? null, setMethod: setter ?? null,
    declaredAccessibility: accessor.declaredAccessibility, modifiers: accessor.modifiers});
}
