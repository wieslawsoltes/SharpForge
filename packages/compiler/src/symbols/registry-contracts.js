import {MethodSymbol, ParameterSymbol, DeclarationModifiers} from './members.js';

/** Adapt a closed registry parameter, retaining params metadata for ordinary overload binding. */
export function registryParameter(bridge, typeName, index, isParams = false) {
  return new ParameterSymbol({
    name: 'arg' + index,
    type: bridge.typeFromName(typeName) ?? bridge.objectType,
    ordinal: index,
    isParams
  });
}

/** Create and index the method symbol for one immutable ABI contract. */
export function registryContractMethod(bridge, contract, kind, common) {
  const method = new MethodSymbol({
    ...common,
    name: contract.name,
    methodKind: kind,
    returnType: contract.kind === 'constructor' ? bridge.byName.get('void')
      : bridge.typeFromName(contract.result) ?? bridge.objectType,
    parameters: contract.parameters.map((type, index) => bridge.parameter(type, index, contract.paramsIndex === index)),
    modifiers: contract.isStatic ? DeclarationModifiers.Static : 0
  });
  method.contract = contract;
  bridge.contractSymbols.set(contract.id, method);
  return method;
}
