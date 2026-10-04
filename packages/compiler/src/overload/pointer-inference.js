/** Structural type inference for data pointers and function pointers (C# 9 function-pointers, "Type inference"). */
import { RefKind, TypeKind, typeOf } from '../symbols/types.js';
import { sameCallingConvention } from '../symbols/function-pointer-conventions.js';

export const InferenceBoundKind = Object.freeze({ Exact: 0, Lower: 1, Upper: 2 });

/** Function-pointer calling convention, arity and by-reference signature shape must agree before any bound is added. */
function sameSignatureShape(source, target) {
  return sameCallingConvention(source, target) &&
    source.returnRefKind === target.returnRefKind &&
    source.parameters.length === target.parameters.length &&
    source.parameters.every((parameter, index) => parameter.refKind === target.parameters[index].refKind);
}

/** Value types and by-reference slots are invariant; variance is possible only for by-value reference types. */
function inferSlot(inferrer, source, target, boundKind, refKind) {
  source = typeOf(source);
  target = typeOf(target);
  if (boundKind === InferenceBoundKind.Exact || refKind !== RefKind.None || source.isReferenceType !== true) {
    inferrer.exact(source, target);
  } else if (boundKind === InferenceBoundKind.Lower) {
    inferrer.lower(source, target);
  } else {
    inferrer.upper(source, target);
  }
}

/**
 * Adds bounds for matching pointer shapes; returns true when a pointer pair has been handled.
 * Data-pointer pointees participate in exact inference only; input inference selects that mode for pointer
 * arguments. Raw pointer returns do not contribute lower bounds in output inference. Function-pointer returns
 * follow the requested direction, parameters reverse it;
 * by-reference slots and non-reference types infer exactly. A signature mismatch contributes no partial bounds.
 */
export function inferPointerBounds(inferrer, source, target, boundKind) {
  if (source.typeKind === TypeKind.Pointer && target.typeKind === TypeKind.Pointer) {
    if (boundKind === InferenceBoundKind.Exact) inferrer.exact(source.pointedAtType, target.pointedAtType);
    return true;
  }
  if (source.typeKind !== TypeKind.FunctionPointer || target.typeKind !== TypeKind.FunctionPointer) return false;
  const from = source.signature;
  const to = target.signature;
  if (!sameSignatureShape(from, to)) return true;
  inferSlot(inferrer, from.returnType, to.returnType, boundKind, from.returnRefKind);
  const parameterKind = boundKind === InferenceBoundKind.Exact ? boundKind :
    boundKind === InferenceBoundKind.Lower ? InferenceBoundKind.Upper : InferenceBoundKind.Lower;
  for (let index = 0; index < from.parameters.length; index++) {
    const parameter = from.parameters[index];
    inferSlot(inferrer, parameter.type, to.parameters[index].type, parameterKind, parameter.refKind);
  }
  return true;
}
