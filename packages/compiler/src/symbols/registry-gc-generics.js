import {ArrayTypeSymbol, TypeParameterSymbol, Accessibility} from './types.js';
import {MethodSymbol, ParameterSymbol, DeclarationModifiers} from './members.js';

/** Only the GC allocation family opts into generic framework method binding. */
export function registryGCGenericMethods(bridge, entry, owner) {
  return (entry?.gcArrayMethods ?? []).map(({name, contract}) => {
    const element = new TypeParameterSymbol({name: 'T'});
    const method = new MethodSymbol({
      name, containingSymbol: owner, declaredAccessibility: Accessibility.Public,
      modifiers: DeclarationModifiers.Static, typeParameters: [element],
      returnType: new ArrayTypeSymbol(element, 1, {baseType: bridge.typeFromName('System.Array')}),
      parameters: [
        new ParameterSymbol({name: 'length', type: bridge.typeFromName('int')}),
        new ParameterSymbol({name: 'pinned', type: bridge.typeFromName('bool'), explicitDefaultValue: {value: false}})
      ]
    });
    method.gcArrayAllocation = true;
    method.contract = contract;
    return method;
  });
}
