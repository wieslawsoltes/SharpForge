/** Monomorphization of user-defined generics for the semantic code generator (SF-A02-T02.6). */
export { GenericInstantiations, InstantiationTable, TypeInstance, MemberInstance } from './instantiations.js';
export { GenericDeclarations } from './declare-instantiations.js';
export { FrameworkConstructions } from './framework-constructions.js';
export { typeKey, typeNameText, imageTypeNameText, instantiationTypeName, instantiationMethodName } from './instantiation-names.js';

import { GenericTranslation as SourceGenericTranslation } from './translate-generics.js';
import { FrameworkGenericTranslation } from './translate-framework-generics.js';
import { PrimitiveMemberTranslation } from './translate-primitive-members.js';

/** Class mixin for the body translator: constructions of source generics and of framework generics, members of simple types. */
export const GenericTranslation = Base => PrimitiveMemberTranslation(FrameworkGenericTranslation(SourceGenericTranslation(Base)));
