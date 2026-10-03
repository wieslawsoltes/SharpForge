/**
 * Nullability of overrides, interface implementations and constraints (SF-A02-T05.6).
 *
 * In an enabled annotation context the nullability of reference types is part of a signature's contract. An
 * override or implementation may be *more* permissive on input (accept null where the base does not) and *more*
 * strict on output (never return null where the base may), never the reverse:
 *   CS8764 / CS8765   return type / parameter type of an override does not match the overridden member
 *   CS8766 / CS8767   ... of an implicit interface implementation       CS8768 / CS8769   ... of an explicit one
 *   CS8608            nullability of a field-like type (property, event) does not match the overridden member
 * Oblivious types (declared where annotations are disabled) match anything.
 */
import { NullableAnnotation, SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const isOblivious = typeWithAnnotations => !typeWithAnnotations || typeWithAnnotations.nullableAnnotation === NullableAnnotation.Oblivious;
const isAnnotated = typeWithAnnotations => typeWithAnnotations.nullableAnnotation === NullableAnnotation.Annotated;
const isReferenceType = typeWithAnnotations => typeWithAnnotations?.type?.isReferenceType === true;

/** 'same' | 'saferOutput' (derived non-null, base nullable) | 'saferInput' (derived nullable, base non-null). */
function compareTopLevel(derived, base) {
  if (isOblivious(derived) || isOblivious(base) || !isReferenceType(derived) || !isReferenceType(base)) return 'same';
  if (isAnnotated(derived) === isAnnotated(base)) return 'same';
  return isAnnotated(derived) ? 'saferInput' : 'saferOutput';
}

/** True when type arguments differ in nullability anywhere below the top level (always a mismatch: generics are invariant). */
function nestedMismatch(derived, base) {
  const derivedArguments = derived?.type?.typeArguments ?? [];
  const baseArguments = base?.type?.typeArguments ?? [];
  if (derivedArguments.length !== baseArguments.length) return false;
  return derivedArguments.some((argument, index) => {
    const other = baseArguments[index];
    const bothKnown = !isOblivious(argument) && !isOblivious(other) && isReferenceType(argument);
    return (bothKnown && isAnnotated(argument) !== isAnnotated(other)) || nestedMismatch(argument, other);
  });
}

const returnIsCompatible = (derived, base) => compareTopLevel(derived, base) !== 'saferInput' && !nestedMismatch(derived, base);
const parameterIsCompatible = (derived, base) => compareTopLevel(derived, base) !== 'saferOutput' && !nestedMismatch(derived, base);

/**
 * Compares the nullability of two method signatures with identical types.
 * @param {{ returnCode: string, parameterCode: string }} codes the diagnostics of this relation
 * @returns {{ code: string, args: string[] }[]}
 */
export function compareMethodNullability(derived, base, codes) {
  const results = [];
  // Roslyn reports one mismatch per member: the return type when it disagrees, otherwise the parameters.
  if (!returnIsCompatible(derived.returnTypeWithAnnotations, base.returnTypeWithAnnotations)) return [{ code: codes.returnCode, args: [] }];
  derived.parameters.forEach((parameter, index) => {
    const other = base.parameters[index];
    if (!other) return;
    // out parameters are outputs: the stricter side must be the override, as for return types.
    const compatible =
      parameter.refKind === 'out'
        ? returnIsCompatible(parameter.typeWithAnnotations, other.typeWithAnnotations)
        : parameter.refKind === 'ref'
          ? compareTopLevel(parameter.typeWithAnnotations, other.typeWithAnnotations) === 'same'
          : parameterIsCompatible(parameter.typeWithAnnotations, other.typeWithAnnotations);
    if (!compatible) results.push({ code: codes.parameterCode, args: [parameter.name] });
  });
  return results;
}

const overrideCodes = Object.freeze({ returnCode: 'CS8764', parameterCode: 'CS8765' });
const implicitImplementationCodes = Object.freeze({ returnCode: 'CS8766', parameterCode: 'CS8767' });
const explicitImplementationCodes = Object.freeze({ returnCode: 'CS8768', parameterCode: 'CS8769' });

function implementationArgs(diagnostic, implemented) {
  // The implementation diagnostics name the parameter (when there is one) and the interface member.
  return [...diagnostic.args, implemented.toDisplayString()];
}

/**
 * Nullability diagnostics of one source type: its overrides against the overridden members and its interface
 * implementations against the interface members.
 * @param type a source type whose overrides and interface map are bound
 * @returns {{ code: string, args: string[], member: object }[]}
 */
export function checkNullableSignatures(type) {
  const results = [];
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return results;
  for (const member of type.getMembers()) {
    if (member.kind === SymbolKind.Method && member.methodKind === MethodKind.Ordinary && member.overriddenMethod) {
      for (const d of compareMethodNullability(member, member.overriddenMethod, overrideCodes)) results.push({ ...d, member });
    }
    if (member.kind === SymbolKind.Property && member.overriddenMember) {
      const base = member.overriddenMember;
      const position = member.setMethod ? 'both' : 'output';
      const relation = compareTopLevel(member.typeWithAnnotations, base.typeWithAnnotations);
      const mismatch = position === 'both' ? relation !== 'same' : relation === 'saferInput';
      if (mismatch || nestedMismatch(member.typeWithAnnotations, base.typeWithAnnotations))
        results.push({ code: 'CS8608', args: [], member });
    }
  }
  for (const [declaration, implementation] of type.interfaceImplementations ?? []) {
    if (declaration === implementation || declaration.kind !== SymbolKind.Method || implementation.kind !== SymbolKind.Method) continue;
    if (declaration.isAccessor || implementation.containingType?.originalDefinition !== type) continue;
    const codes = implementation.explicitInterfaceType ? explicitImplementationCodes : implicitImplementationCodes;
    for (const d of compareMethodNullability(implementation, declaration, codes)) {
      results.push({ code: d.code, args: implementationArgs(d, declaration), member: implementation });
    }
  }
  return results;
}
