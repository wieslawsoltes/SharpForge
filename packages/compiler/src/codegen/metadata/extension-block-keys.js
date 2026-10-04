/** Stable grouping and marker identities for source extension declarations; names do not depend on source order. */
import { sha256 } from '@sharpforge/cil';
import { TypeKind, TypeWithAnnotations } from '../../symbols/types.js';
import { floatBits, doubleBits } from '../../constants/constant-value.js';
import { MetadataEmitError } from './type-tokens.js';

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
    this.depth = 0;
    this.visited = 0;
  }

  type(type) {
    if (++this.depth > 128 || ++this.visited > 100_000) {
      throw new MetadataEmitError('extension metadata signature exceeds the bounded type-shape limit');
    }
    try {
      return this.typeKey(type);
    } finally {
      this.depth--;
    }
  }

  typeKey(type) {
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
    const identity = definition.containingAssembly?.identity;
    const assembly = identity?.getDisplayName?.() ?? identity?.name ?? definition.containingAssembly?.name ?? null;
    // An open definition's own type parameters point back to it; they describe its arity, not constructed arguments.
    const arguments_ = type.isDefinition || type.isUnboundGenericType ? [] : type.typeArguments ?? [];
    return ['type', assembly, definition.metadataFullName,
      type.containingType ? this.type(type.containingType) : null,
      arguments_.map(argument => this.slot(argument)),
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
    if (expression.kind === 'ArrayCreation') return ['array', this.type(expression.type),
      (expression.elements ?? []).map(element => this.value(element))];
    if (expression.constantValue) {
      const constant = expression.constantValue;
      const type = expression.type.specialType === 'System_Object' ? expression.operand?.type ?? expression.type : expression.type;
      const value = constant.type === 'float' ? floatBits(constant.value)
        : constant.type === 'double' ? doubleBits(constant.value) : constant.value;
      return ['constant', this.type(type), constant.type, value];
    }
    if (expression.kind === 'Conversion') return this.value(expression.operand);
    return expression.kind;
  }

  attributes(symbol) {
    return (symbol.boundAttributes ?? []).map(attribute => [
      this.type(attribute.attributeClass), attribute.location,
      attribute.attributeConstructor?.parameters.map(parameter => this.slot(parameter.typeWithAnnotations)) ?? null,
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
