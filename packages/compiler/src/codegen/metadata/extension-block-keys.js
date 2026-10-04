/** Stable grouping and marker identities for source extension declarations; names do not depend on source order. */
import { sha256 } from '@sharpforge/cil';
import { TypeKind, TypeWithAnnotations } from '../../symbols/types.js';

const constraintFlags = Object.freeze([
  'variance', 'hasReferenceTypeConstraint', 'hasValueTypeConstraint', 'hasUnmanagedTypeConstraint',
  'hasConstructorConstraint', 'allowsRefLikeType',
]);

/** A metadata-only name component, using the existing synchronous hash and a bounded UTF-8 signature. */
export function extensionMetadataName(prefix, signature) {
  const digest = sha256(new TextEncoder().encode(signature));
  return `<${prefix}>$` + Array.from(digest.subarray(0, 16), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

class SignatureKeys {
  constructor(parameters, annotated) {
    this.parameters = new Map(parameters.map((parameter, index) => [parameter, index]));
    this.annotated = annotated;
  }

  type(type) {
    if (this.parameters.has(type)) return ['parameter', this.parameters.get(type)];
    if (!this.annotated && (type.typeKind === TypeKind.Dynamic || type.specialType === 'System_Object')) return 'object';
    if (type.typeKind === TypeKind.Dynamic) return 'dynamic';
    if (type.typeKind === TypeKind.Array) return ['array', type.rank, type.isSZArray, this.slot(type.elementTypeWithAnnotations)];
    if (type.typeKind === TypeKind.Pointer) return ['pointer', this.slot(type.pointedAtTypeWithAnnotations)];
    if (type.typeKind === TypeKind.FunctionPointer) {
      const signature = type.signature;
      return ['functionPointer', signature.callingConvention, signature.unmanagedConventions, signature.returnRefKind,
        this.slot(signature.returnType), signature.parameters.map(parameter => [parameter.refKind, this.slot(parameter.type)])];
    }
    const definition = type.originalDefinition;
    const assembly = definition.containingAssembly?.identity?.name ?? definition.containingAssembly?.name ?? null;
    return ['type', assembly, definition.metadataFullName,
      type.containingType ? this.type(type.containingType) : null,
      (type.typeArguments ?? []).map(argument => this.slot(argument)),
      ...(this.annotated ? [!!type.isNativeInteger, type.tupleElementNames ?? null] : [])];
  }

  slot(value) {
    const annotated = value instanceof TypeWithAnnotations ? value : new TypeWithAnnotations(value);
    return [this.type(annotated.type), this.annotated ? annotated.nullableAnnotation : null,
      (annotated.customModifiers ?? []).map(modifier => [modifier.isOptional, this.type(modifier.modifier ?? modifier.type)])];
  }

  constraints(parameter) {
    const constraints = parameter.constraintTypes.map(type => {
      const annotated = this.annotated ? parameter.constraintTypesWithAnnotations?.get(type) ?? type : type;
      return JSON.stringify(this.slot(annotated));
    }).sort();
    return [constraintFlags.map(flag => parameter[flag]), constraints,
      ...(this.annotated ? [parameter.name, !!parameter.hasNotNullConstraint, !!parameter.referenceTypeConstraintIsNullable] : [])];
  }

  value(expression) {
    if (expression.kind === 'TypeOf') return ['typeof', this.type(expression.operandType)];
    if (expression.kind === 'ArrayCreation') return ['array', (expression.elements ?? []).map(element => this.value(element))];
    if (expression.constantValue) return ['constant', expression.constantValue.type, expression.constantValue.value];
    if (expression.kind === 'Conversion') return this.value(expression.operand);
    return expression.kind;
  }

  attributes(symbol) {
    return (symbol.boundAttributes ?? []).map(attribute => [
      this.type(attribute.attributeClass), attribute.location,
      attribute.arguments.map(argument => this.value(argument)),
      attribute.named.map(argument => [argument.name, this.value(argument.value)]),
    ]);
  }
}

const serialize = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? ['bigint', item.toString()] : item);

/** CLR identity groups blocks; exact receiver spelling, names, constraints and attributes distinguish markers. */
export function extensionBlockKeys(implementation) {
  const count = implementation.extensionBlock.typeParameterList?.parameters.length ?? 0;
  const parameters = implementation.typeParameters.slice(0, count);
  const receiver = implementation.extensionReceiver;
  const clr = new SignatureKeys(parameters, false);
  const exact = new SignatureKeys(parameters, true);
  return {
    parameters,
    grouping: serialize([clr.slot(receiver.typeWithAnnotations), parameters.map(parameter => clr.constraints(parameter))]),
    marker: serialize([receiver.name, receiver.refKind, receiver.scoped, exact.slot(receiver.typeWithAnnotations),
      exact.attributes(receiver), parameters.map(parameter => [exact.constraints(parameter), exact.attributes(parameter)])]),
  };
}
