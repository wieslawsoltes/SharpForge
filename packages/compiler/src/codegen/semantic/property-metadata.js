import {accessorBaseName} from '../../binder/members/indexer-names.js';

/** Preserve source property/indexer associations alongside executable accessor methods for PE metadata and binding tokens. */
export function declareSourcePropertyMetadata(generator, owner, symbol) {
  const get = symbol.getMethod ? generator.methods.get(symbol.getMethod)?.id ?? null : null;
  const set = symbol.setMethod ? generator.methods.get(symbol.setMethod)?.id ?? null : null;
  if (get === null && set === null) return;
  const property = {
    name: accessorBaseName(symbol),
    type: generator.types.imageType(symbol.type, symbol.locations?.[0]),
    isStatic: symbol.isStatic,
    access: symbol.declaredAccessibility,
    get, set, backing: symbol.isAutoProperty ? '<' + symbol.name + '>k__BackingField' : null
  };
  if (symbol.parameters?.length) {
    property.parameters = symbol.parameters.map(parameter => ({
      name: parameter.name, type: generator.types.imageType(parameter.type, parameter.locations?.[0])
    }));
  }
  owner.properties.push(property);
}

export function sourcePropertyDescriptors(properties) {
  return properties.map(property => ({...property,
    ...(property.parameters ? {parameters: property.parameters.map(parameter => ({...parameter}))} : {})}));
}
