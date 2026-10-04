/** NullableAttribute transforms, shared by source emission and metadata import (SF-A02-T05.3). */
import {
  NullableAnnotation, TypeWithAnnotations, NamedTypeSymbol, ArrayTypeSymbol, PointerTypeSymbol,
  FunctionPointerTypeSymbol, TypeParameterSymbol, DynamicTypeSymbol, ErrorTypeSymbol,
} from '../symbols/types.js';
import { flatTypeArguments, withTypeArguments, withArrayElement, withErrorTypeArguments, withFunctionPointerTypes } from '../symbols/annotated-type-shape.js';

const byteOf = annotation => annotation === NullableAnnotation.Annotated ? 2 : annotation === NullableAnnotation.NotAnnotated ? 1 : 0;
const annotationOf = flag => flag === 1 ? NullableAnnotation.NotAnnotated : flag === 2 ? NullableAnnotation.Annotated : NullableAnnotation.Oblivious;
const mismatch = Symbol('nullable transform length mismatch');

/** The complete pre-order transform of a type use. Nullable<T> contributes only T; pointers contribute a zero slot. */
export function encodeNullableFlags(typeWithAnnotations) {
  const bytes = [];
  const pending = [TypeWithAnnotations.create(typeWithAnnotations)];
  while (pending.length) {
    const annotated = pending.pop();
    const type = annotated.type;
    if (type instanceof TypeParameterSymbol || type instanceof DynamicTypeSymbol) {
      bytes.push(type.isValueType === true ? 0 : byteOf(annotated.nullableAnnotation));
    } else if (type instanceof ArrayTypeSymbol) {
      bytes.push(byteOf(annotated.nullableAnnotation));
      pending.push(type.elementTypeWithAnnotations);
    } else if (type instanceof PointerTypeSymbol) {
      bytes.push(0);
      pending.push(type.pointedAtTypeWithAnnotations);
    } else if (type instanceof FunctionPointerTypeSymbol) {
      bytes.push(0);
      const signature = type.signature;
      for (let index = signature.parameters.length - 1; index >= 0; index--) pending.push(signature.parameters[index].type);
      pending.push(signature.returnType);
    } else if (type instanceof NamedTypeSymbol || type instanceof ErrorTypeSymbol) {
      const args = type instanceof NamedTypeSymbol ? flatTypeArguments(type) : type.typeArguments;
      if (!type.isValueType) bytes.push(byteOf(annotated.nullableAnnotation));
      else if (args.length && !type.isNullableValueType) bytes.push(0);
      for (let index = args.length - 1; index >= 0; index--) pending.push(TypeWithAnnotations.create(args[index]));
    }
  }
  return bytes;
}

/** Applies an attribute's scalar or exact vector; malformed vectors leave the original annotated type unchanged. */
export function applyNullableMetadataFlags(type, flags, defaultFlag = 0) {
  const input = TypeWithAnnotations.create(type);
  if (flags == null && !defaultFlag) return input;
  const uniform = Array.isArray(flags) ? null : flags ?? defaultFlag;
  let position = 0;
  const next = () => {
    if (uniform !== null) return uniform;
    if (position >= flags.length) throw mismatch;
    return flags[position++];
  };
  const visit = annotated => {
    const type = annotated.type;
    if (type instanceof TypeParameterSymbol || type instanceof DynamicTypeSymbol) return annotated.withAnnotation(annotationOf(next()));
    if (type instanceof ArrayTypeSymbol) {
      const flag = next();
      return annotated.withType(withArrayElement(type, visit(type.elementTypeWithAnnotations))).withAnnotation(annotationOf(flag));
    }
    if (type instanceof PointerTypeSymbol) {
      next();
      const pointee = visit(type.pointedAtTypeWithAnnotations);
      return pointee === type.pointedAtTypeWithAnnotations ? annotated : annotated.withType(new PointerTypeSymbol(pointee));
    }
    if (type instanceof FunctionPointerTypeSymbol) {
      next();
      return annotated.withType(withFunctionPointerTypes(type, visit));
    }
    if (type instanceof ErrorTypeSymbol) {
      const flag = next();
      const args = type.typeArguments.map(argument => visit(TypeWithAnnotations.create(argument)));
      return annotated.withType(withErrorTypeArguments(type, args)).withAnnotation(annotationOf(flag));
    }
    if (type instanceof NamedTypeSymbol) {
      const args = flatTypeArguments(type);
      if (type.isValueType) {
        if (!args.length) return annotated;
        if (!type.isNullableValueType) next();
        return annotated.withType(withTypeArguments(type, args.map(visit)));
      }
      const flag = next();
      return annotated.withType(withTypeArguments(type, args.map(visit))).withAnnotation(annotationOf(flag));
    }
    return annotated;
  };
  try {
    const result = visit(input);
    return uniform === null && position !== flags.length ? input : result;
  } catch (error) {
    if (error === mismatch) return input;
    throw error;
  }
}

/** The historical source-helper form treats a one-element vector as the compact scalar representation. */
export function decodeNullableFlags(type, bytes, contextFlag = 0) {
  return applyNullableMetadataFlags(type, bytes?.length === 1 ? bytes[0] : bytes, contextFlag);
}

/** Roslyn's compact representation uses a scalar when every transform byte is equal. */
export function compactNullableFlags(bytes) {
  return bytes.length > 1 && bytes.every(byte => byte === bytes[0]) ? [bytes[0]] : bytes;
}

/** Most frequent byte (ties prefer 0, then 1). Scope planning supplies only eligible scalar attributes. */
export function nullableContextFlag(flagLists) {
  const counts = [0, 0, 0];
  for (const list of flagLists) for (const byte of list) counts[byte]++;
  let best = 0;
  for (let byte = 1; byte < 3; byte++) if (counts[byte] > counts[best]) best = byte;
  return best;
}

/** The explicit transform required for a type use under the enclosing metadata context. */
export function nullableAttributeFor(typeWithAnnotations, contextFlag) {
  const bytes = compactNullableFlags(encodeNullableFlags(typeWithAnnotations));
  return { nullable: bytes.length === 0 || (bytes.length === 1 && bytes[0] === contextFlag) ? null : bytes };
}
