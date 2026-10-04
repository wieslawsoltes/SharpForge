import {Accessibility} from './types.js';
import {PropertySymbol, ParameterSymbol} from './members.js';

/**
 * Registered type metadata may name its default indexed property with `defaultMember: string`.
 * The name must be nonempty; absent metadata inherits a registered base's name, then defaults to Item.
 */
export function registeredIndexerName(entry, types) {
  for (let remaining = types.size + 1; entry && remaining > 0; remaining--) {
    if (entry.defaultMember !== undefined) {
      if (typeof entry.defaultMember !== 'string' || !entry.defaultMember.length) {
        throw new TypeError('Registered defaultMember must be a nonempty string');
      }
      return entry.defaultMember;
    }
    entry = types.get(entry.base);
  }
  return 'Item';
}

/** Synthesize indexer symbols over the existing accessor methods, without aliases or new contracts. */
export function appendRegistryIndexers(members, owner, entry, types) {
  const name = registeredIndexerName(entry, types);
  const getterName = 'get_' + name;
  const setterName = 'set_' + name;
  const getters = members.filter(member => member.kind === 'Method' && member.name === getterName && !member.isStatic);
  if (!getters.length) return;
  const setters = members.filter(member => member.kind === 'Method' && member.name === setterName && !member.isStatic);
  for (const getter of getters) {
    const setter = setters.find(candidate => candidate.parameters.length === getter.parameters.length + 1 &&
      getter.parameters.every((parameter, index) => parameter.type.equals(candidate.parameters[index].type))) ?? null;
    const indexer = new PropertySymbol({
      name: 'this[]', type: getter.returnType, declaredAccessibility: Accessibility.Public, containingSymbol: owner,
      parameters: getter.parameters.map((parameter, ordinal) => new ParameterSymbol({
        name: parameter.name, type: parameter.type, ordinal
      }))
    });
    indexer.getMethod = getter;
    indexer.setMethod = setter;
    members.push(indexer);
  }
}
