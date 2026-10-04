/** Structural lookup keys for extension implementation signatures, with block VARs flattened into method MVARs. */
import { SymbolKind, TypeKind } from '../symbols/types.js';

export const extensionConstraintFlags = Object.freeze([
  'variance', 'hasReferenceTypeConstraint', 'hasValueTypeConstraint', 'hasUnmanagedTypeConstraint',
  'hasConstructorConstraint', 'allowsRefLikeType',
]);

/**
 * Index once by the complete CLR signature and constraints, rather than comparing every overload with every
 * grouping declaration. Declaration keys use positional aliases for the group's and marker's type parameters;
 * dynamic/object, tuple names, native integer spelling and nullable annotations have their CLR identity.
 * Candidate lists only remain for duplicate metadata signatures, which the caller rejects as ambiguous.
 */
export class ExtensionImplementationIndex {
  constructor(type) {
    this.definitions = new Map();
    this.methods = new Map();
    for (const method of type.getMembers()) {
      if (method.kind !== SymbolKind.Method || !method.isStatic || method.isConstructor) continue;
      const key = this.key(method);
      const candidates = this.methods.get(key) ?? [];
      candidates.push(method);
      this.methods.set(key, candidates);
    }
  }

  candidates(declaration, block) {
    return this.methods.get(this.key(declaration, block)) ?? [];
  }

  definitionId(type) {
    if (!this.definitions.has(type)) this.definitions.set(type, this.definitions.size);
    return this.definitions.get(type);
  }

  modifiers(modifiers, parameters) {
    return (modifiers ?? []).map(modifier => [modifier.isOptional, this.type(modifier.type ?? modifier.modifier, parameters)]);
  }

  slotModifiers(modifiers, parameters) {
    return ['outer', 'inner'].map(position => this.modifiers(modifiers?.[position], parameters));
  }

  annotated(type, parameters) {
    return [this.type(type.type, parameters), this.modifiers(type.customModifiers, parameters)];
  }

  type(type, parameters) {
    if (type.typeKind === TypeKind.Dynamic || type.specialType === 'System_Object') return 'object';
    if (parameters.has(type)) return ['parameter', parameters.get(type)];
    if (type.typeKind === TypeKind.TypeParameter) return ['foreignParameter', this.definitionId(type)];
    if (type.typeKind === TypeKind.Array)
      return ['array', type.rank, type.isSZArray, this.annotated(type.elementTypeWithAnnotations, parameters)];
    if (type.typeKind === TypeKind.Pointer) return ['pointer', this.annotated(type.pointedAtTypeWithAnnotations, parameters)];
    if (type.typeKind === TypeKind.FunctionPointer) {
      const signature = type.signature;
      return ['functionPointer', signature.callingConvention, signature.unmanagedConventions, signature.returnRefKind,
        this.annotated(signature.returnType, parameters),
        signature.parameters.map(parameter => [parameter.refKind, this.annotated(parameter.type, parameters)])];
    }
    return ['type', this.definitionId(type.originalDefinition),
      type.containingType ? this.type(type.containingType, parameters) : null,
      (type.typeArguments ?? []).map(argument => this.annotated(argument, parameters))];
  }

  parameter(parameter, parameters) {
    return [parameter.refKind, this.annotated(parameter.typeWithAnnotations, parameters),
      this.slotModifiers(parameter.customModifiers, parameters)];
  }

  key(method, block = null) {
    const blockArity = block?.group.arity ?? 0;
    const own = [...(block?.group.typeParameters ?? []), ...method.typeParameters];
    const parameters = new Map(own.map((parameter, index) => [parameter, index]));
    block?.typeParameters.forEach((parameter, index) => parameters.set(parameter, index));
    const constraints = [...(block?.typeParameters ?? []), ...method.typeParameters].map(parameter => [
      extensionConstraintFlags.map(flag => parameter[flag]),
      parameter.constraintTypes.map(constraint => JSON.stringify(this.annotated(constraint, parameters))).sort(),
    ]);
    const receiver = block && !method.isStatic ? [block.receiver] : [];
    return JSON.stringify([
      method.name, blockArity + method.arity, method.declaredAccessibility, method.isVararg, method.refKind,
      this.annotated(method.returnTypeWithAnnotations, parameters), this.slotModifiers(method.returnCustomModifiers, parameters),
      [...receiver, ...method.parameters].map(parameter => this.parameter(parameter, parameters)), constraints,
    ]);
  }
}
