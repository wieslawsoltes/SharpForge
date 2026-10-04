import {MethodSymbol, ParameterSymbol, MethodKind} from './members.js';
import {Accessibility} from './types.js';

/** Nullable<T> has one value constructor; parameterless construction remains default value initialization. */
export function declareNullableConstructor(core) {
  const type = core.nullable;
  if (type.getMembers('.ctor').some(method => method.parameters.length === 1)) return;
  type.addMember(new MethodSymbol({
    name: '.ctor', methodKind: MethodKind.Constructor, returnType: core.void,
    parameters: [new ParameterSymbol({name: 'value', type: type.typeParameters[0]})],
    declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true
  }));
}
