import {PropertySymbol, ParameterSymbol, MethodKind} from './members.js';

/** Registered get_Item/set_Item signatures expose one indexer with associated accessors. */
export function addRegistryIndexers(members, ownerOptions) {
  const getters = members.filter(member => member.kind === 'Method' && member.name === 'get_Item' && !member.isStatic);
  for (const getter of getters) {
    const setter = members.find(member => member.kind === 'Method' && member.name === 'set_Item' && !member.isStatic &&
      member.parameters.length === getter.parameters.length + 1 &&
      getter.parameters.every((parameter, index) => parameter.type.equals(member.parameters[index].type))) ?? null;
    const indexer = new PropertySymbol({...ownerOptions, name: 'this[]', type: getter.returnType,
      parameters: getter.parameters.map((parameter, ordinal) => new ParameterSymbol({name: parameter.name, type: parameter.type, ordinal}))});
    indexer.getMethod = getter;
    indexer.setMethod = setter;
    getter.methodKind = MethodKind.PropertyGet;
    getter.associatedSymbol = indexer;
    if (setter) {
      setter.methodKind = MethodKind.PropertySet;
      setter.associatedSymbol = indexer;
    }
    members.push(indexer);
  }
}
