/**
 * Nullability of overrides, interface implementations and constraints (SF-A02-T05.6).
 *
 * In an enabled annotation context the nullability of reference types is part of a signature's contract. An
 * override or implementation may be *more* permissive on input (accept null where the base does not) and *more*
 * strict on output (never return null where the base may), never the reverse:
 *                           return type        parameter type     event type
 *   override                CS8764 / CS8609    CS8765 / CS8610    CS8608
 *   implicit implementation CS8766 / CS8613    CS8767 / CS8614    CS8612
 *   explicit implementation CS8768 / CS8616    CS8769 / CS8617    CS8615
 * The first code of a pair is a mismatch at the top level of the type (`string` against `string?`), the second one
 * below it (`List<string?>` against `List<string>`), where no variance applies. A property is checked accessor by
 * accessor - the getter as a method that returns the property type, the setter as one that takes it as `value` - and
 * reported on the accessor. Oblivious types (declared where annotations are disabled) match anything.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
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

/** 'ok' | 'top' (variance violated at the top level) | 'nested' (a type argument differs). */
function returnMismatch(derived, base) {
  if (compareTopLevel(derived, base) === 'saferInput') return 'top';
  return nestedMismatch(derived, base) ? 'nested' : 'ok';
}
function parameterMismatch(parameter, other) {
  const derived = parameter.typeWithAnnotations,
    base = other.typeWithAnnotations,
    relation = compareTopLevel(derived, base);
  // out parameters are outputs: the stricter side must be the override, as for return types; ref goes both ways.
  const isTop = parameter.refKind === 'out' ? relation === 'saferInput' : parameter.refKind === 'ref' ? relation !== 'same' : relation === 'saferOutput';
  if (isTop) return 'top';
  return nestedMismatch(derived, base) ? 'nested' : 'ok';
}

const families = Object.freeze({
  override: {
    returns: { top: DiagnosticId.CS8764, nested: DiagnosticId.CS8609 },
    parameter: { top: DiagnosticId.CS8765, nested: DiagnosticId.CS8610 },
    event: DiagnosticId.CS8608,
    returnArgs: () => [],
    parameterArgs: name => [name],
    eventArgs: () => [],
  },
  implicit: {
    returns: { top: DiagnosticId.CS8766, nested: DiagnosticId.CS8613 },
    parameter: { top: DiagnosticId.CS8767, nested: DiagnosticId.CS8614 },
    event: DiagnosticId.CS8612,
    returnArgs: (derived, base) => [derived, base],
    parameterArgs: (name, derived, base) => [name, derived, base],
    eventArgs: (derived, base) => [derived, base],
  },
  explicit: {
    returns: { top: DiagnosticId.CS8768, nested: DiagnosticId.CS8616 },
    parameter: { top: DiagnosticId.CS8769, nested: DiagnosticId.CS8617 },
    event: DiagnosticId.CS8615,
    returnArgs: (derived, base) => [base],
    parameterArgs: (name, derived, base) => [name, base],
    eventArgs: (derived, base) => [base],
  },
});

/**
 * Compares the nullability of two signatures with identical types.
 * @param derived `{returnTypeWithAnnotations, parameters}` of the override or implementation  @param base of what it replaces
 * @param family one of `families`  @param {string[]} names the displays of the two members, for the messages
 * @returns {{ code: string, args: string[] }[]}
 */
export function compareSignatureNullability(derived, base, family, names = ['', '']) {
  // Roslyn reports one mismatch per member for the return type, and otherwise one per parameter.
  const returns = returnMismatch(derived.returnTypeWithAnnotations, base.returnTypeWithAnnotations);
  if (returns !== 'ok') return [{ code: family.returns[returns], args: family.returnArgs(...names) }];
  const results = [];
  derived.parameters.forEach((parameter, index) => {
    const other = base.parameters[index],
      mismatch = other ? parameterMismatch(parameter, other) : 'ok';
    if (mismatch !== 'ok') results.push({ code: family.parameter[mismatch], args: family.parameterArgs(parameter.name, ...names) });
  });
  return results;
}

/** The getter of a property as a signature: it returns the property type and takes the indexer parameters. */
const getterSignature = property => ({ returnTypeWithAnnotations: property.typeWithAnnotations, parameters: property.parameters ?? [] });
/** The setter: it takes the indexer parameters and the property type as `value`. */
const setterSignature = property => ({
  returnTypeWithAnnotations: null,
  parameters: [...(property.parameters ?? []), { name: 'value', refKind: 'none', typeWithAnnotations: property.typeWithAnnotations }],
});

/** Where an accessor mismatch is reported: the accessor keyword, or the expression of an expression-bodied property. */
function accessorNode(accessor) {
  const syntax = accessor?.syntax;
  return syntax?.keyword ?? syntax?.expressionBody?.expression ?? null;
}

const isTypeMismatch = (derived, base) => compareTopLevel(derived, base) !== 'same' || nestedMismatch(derived, base);

/** The mismatches of one member against the member it overrides or implements. */
function compareMembers(derived, base, family) {
  const names = [derived.toDisplayString(), base.toDisplayString()];
  if (derived.kind === SymbolKind.Method && base.kind === SymbolKind.Method) {
    if (derived.methodKind !== MethodKind.Ordinary) return [];
    return compareSignatureNullability(derived, base, family, names).map(d => ({ ...d, member: derived }));
  }
  if (derived.kind === SymbolKind.Event && base.kind === SymbolKind.Event) {
    const mismatch = isTypeMismatch(derived.typeWithAnnotations, base.typeWithAnnotations);
    return mismatch ? [{ code: family.event, args: family.eventArgs(...names), member: derived }] : [];
  }
  if (derived.kind !== SymbolKind.Property || base.kind !== SymbolKind.Property) return [];
  const results = [],
    accessors = [
      [derived.getMethod, base.getMethod, getterSignature],
      [derived.setMethod, base.setMethod, setterSignature],
    ];
  for (const [accessor, other, signatureOf] of accessors) {
    if (!accessor || !other) continue;
    for (const d of compareSignatureNullability(signatureOf(derived), signatureOf(base), family, names)) {
      results.push({ ...d, member: accessor, node: accessorNode(accessor) });
    }
  }
  return results;
}

/**
 * Nullability diagnostics of one source type: its overrides against the overridden members and its interface
 * implementations against the interface members.
 * @param type a source type whose overrides and interface map are bound
 * @returns {{ code: string, args: string[], member: object, node?: object }[]} `node` is where to report when it is not
 *   the name of `member`
 */
export function checkNullableSignatures(type) {
  const results = [];
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return results;
  for (const member of type.getMembers()) {
    const base = member.overriddenMethod ?? member.overriddenMember;
    if (base && !member.isAccessor) results.push(...compareMembers(member, base, families.override));
  }
  for (const [declaration, implementation] of type.interfaceImplementations ?? []) {
    if (declaration === implementation || declaration.isAccessor || implementation.isAccessor) continue;
    if (implementation.containingType?.originalDefinition !== type) continue;
    results.push(...compareMembers(implementation, declaration, implementation.explicitInterfaceType ? families.explicit : families.implicit));
  }
  return results;
}
