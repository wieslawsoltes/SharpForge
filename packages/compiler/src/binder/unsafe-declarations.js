/**
 * Unsafe code at declaration level (SF-A02-T47, C# spec 23.2, 23.3 and 23.8).
 *
 *   CS0227  an `unsafe` modifier on a type or member without the /unsafe option
 *   CS0764  `unsafe` on one part of a partial member only
 *   CS0214  a pointer type in the signature of a member that is not in an unsafe context
 *   CS8500  (warning) a pointer to a managed type
 *   fixed-size buffers  `fixed int Data[4];` is only a struct member (CS1642), its element type is one of the
 *           primitive types (CS1663), its size a positive constant (CS1665, CS0443 comes from the parser) and it needs
 *           an unsafe context (CS0214). The field's type becomes `T*`: using it yields a pointer to its first element.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, PointerTypeSymbol, ArrayTypeSymbol } from '../symbols/types.js';
import { isPointerType } from '../conversions/pointer.js';
import { isNullableType } from '../conversions/nullable.js';
import { isUnmanagedType } from './constraints.js';

const bufferElementTypes = new Set([
  'System_Boolean',
  'System_Byte',
  'System_SByte',
  'System_Char',
  'System_Int16',
  'System_UInt16',
  'System_Int32',
  'System_UInt32',
  'System_Int64',
  'System_UInt64',
  'System_Single',
  'System_Double',
]);

const modifiersOf = symbol => {
  const syntax = symbol.declarationSyntax ?? (symbol.isFieldLike ? symbol.syntax?.parent?.parent : symbol.syntax);
  return (syntax?.modifiers ?? []).map(token => token.text);
};
const hasUnsafeModifier = symbol =>
  symbol.kind === SymbolKind.NamedType
    ? (symbol.declarations ?? []).some(declaration => (declaration.syntax.modifiers ?? []).some(token => token.text === 'unsafe'))
    : modifiersOf(symbol).includes('unsafe');

/** True when the declaration of `member` (or of an accessor's property, or of a containing type) is an unsafe context. */
export function isUnsafeSymbol(member, type) {
  if (member && (hasUnsafeModifier(member) || (member.associatedSymbol && hasUnsafeModifier(member.associatedSymbol)))) return true;
  for (let t = type ?? member?.containingType; t; t = t.containingType) if (hasUnsafeModifier(t)) return true;
  return false;
}

/** Where CS0214 is reported for a pointer type: the type, or the `delegate*` of a function pointer type (as in Roslyn). */
export const unsafeMarker = pointer =>
  pointer.kind === 'FunctionPointerType' ? { start: pointer.delegateKeyword.span.start, end: pointer.asteriskToken.span.end } : pointer;

/** True for a pointer type and for an array (of arrays) of pointers. */
function isPointerOrArrayOfPointers(type) {
  for (let current = type; current; current = current.elementType) if (isPointerType(current)) return true;
  return false;
}

/** The outermost PointerType or FunctionPointerType node inside a type syntax, or null. */
export function findPointerSyntax(syntax) {
  if (!syntax) return null;
  if (syntax.kind === 'PointerType' || syntax.kind === 'FunctionPointerType') return syntax;
  for (const child of syntax.childNodes?.() ?? []) {
    const found = findPointerSyntax(child);
    if (found) return found;
  }
  return null;
}

/** True for a type the collector tracks: a reference type, or a struct that contains one. Unknown structs count as unmanaged. */
export function isManagedType(type, seen = new Set()) {
  if (!type || type.isErrorType?.() || isPointerType(type) || type.specialType === 'System_Void') return false;
  if (type instanceof ArrayTypeSymbol || type.isReferenceType === true) return true;
  if (type.typeKind === TypeKind.TypeParameter) return !type.hasUnmanagedTypeConstraint;
  if (type.typeKind !== TypeKind.Struct || type.specialType || seen.has(type)) return false;
  seen.add(type);
  const definition = type.originalDefinition ?? type;
  if (!definition.isSource) return false;
  return type.getMembers().some(member => member.kind === SymbolKind.Field && !member.isStatic && !member.isConst && isManagedType(member.type, seen));
}

/** C# 8 'unmanaged constructed types': a constructed generic struct without managed fields, such as `Pair<int>`. */
export function isUnmanagedConstructedType(type) {
  if (!type?.typeArguments?.length || type.isValueType !== true || type.isErrorType?.() || isNullableType(type)) return false;
  return isUnmanagedType(type);
}

/** True when `type` is, or is an array or pointer built from, a pointer to an unmanaged constructed type. */
export function pointsAtConstructedType(type) {
  for (let t = type; t; t = t.elementType ?? t.pointedAtType) {
    if (isPointerType(t) && isUnmanagedConstructedType(t.pointedAtType)) return true;
    if (!(t instanceof ArrayTypeSymbol) && !isPointerType(t)) return false;
  }
  return false;
}

/** The types of a member's signature with the node Roslyn reports each at: the member name, or the parameter name. */
function signatureTypes(member) {
  const own = member.locations?.[0],
    parameters = (member.parameters ?? []).map(parameter => ({ type: parameter.type, node: parameter.syntax?.identifier ?? own }));
  switch (member.kind) {
    case SymbolKind.Field:
      return [{ type: member.type, node: own }];
    case SymbolKind.Method:
      return member.isAccessor ? [] : [{ type: member.returnType, node: own }, ...parameters];
    case SymbolKind.Property:
      return [{ type: member.type, node: own }, ...parameters];
    default:
      return [];
  }
}

function signatureTypeSyntaxes(member) {
  switch (member.kind) {
    case SymbolKind.Field:
      return [member.typeSyntax];
    case SymbolKind.Method:
      return member.isAccessor ? [] : [member.returnTypeSyntax, ...member.parameters.map(parameter => parameter.syntax?.type)];
    case SymbolKind.Property:
      return [member.syntax?.type, ...(member.parameters ?? []).map(parameter => parameter.syntax?.type)];
    case SymbolKind.Event:
      return [member.isFieldLike ? member.syntax?.parent?.type : member.syntax?.type];
    default:
      return [];
  }
}

/**
 * The declaration-level rules of one source type.
 * @param {(syntax: object, scope: object) => {constant: object|null, errors?: boolean}} evaluate binds a constant expression
 * @returns {{code?: string, args?: any[], feature?: string, uri: string, node: object}[]} a row with `feature` is a
 *   use of a language feature (reported through the language-version gate), any other row a diagnostic
 */
export function checkUnsafeDeclarations(type, { allowUnsafe, core, evaluate }) {
  const results = [];
  if (!allowUnsafe)
    for (const declaration of type.declarations ?? [])
      if ((declaration.syntax.modifiers ?? []).some(token => token.text === 'unsafe'))
        results.push({ code: DiagnosticId.CS0227, args: [], uri: declaration.uri, node: declaration.syntax.identifier });
  for (const member of type.getMembers()) {
    if (member.isImplicitlyDeclared || member.kind === SymbolKind.NamedType || (member.kind === SymbolKind.Method && member.isAccessor)) continue;
    const uri = member.uri ?? member.locations?.[0]?.uri,
      add = (code, args, node) => results.push({ code, args, uri, node });
    // Both parts of a partial member are declarations of their own; with /unsafe they must agree on the modifier.
    const definition = member.partialDefinitionPart ?? null;
    for (const part of [definition, member])
      if (!allowUnsafe && part && hasUnsafeModifier(part) && part.locations?.[0]) add(DiagnosticId.CS0227, [], part.locations[0]);
    if (allowUnsafe && definition && hasUnsafeModifier(definition) !== hasUnsafeModifier(member) && member.locations?.[0])
      add(DiagnosticId.CS0764, [], member.locations[0]);
    const isUnsafe = isUnsafeSymbol(member, type);
    const types = signatureTypes(member);
    signatureTypeSyntaxes(member).forEach((syntax, index) => {
      if (isUnsafe || !syntax) return;
      const pointer = findPointerSyntax(syntax);
      if (pointer) add(DiagnosticId.CS0214, [], unsafeMarker(pointer));
      // A pointer type behind an alias (`using unsafe P = int*;`) needs an unsafe context where the alias is used.
      else if (isPointerOrArrayOfPointers(types[index]?.type)) add(DiagnosticId.CS0214, [], syntax.elementType ?? syntax);
    });
    for (const { type: signatureType, node } of types)
      if (node && pointsAtConstructedType(signatureType)) results.push({ feature: 'UnmanagedConstructedTypes', uri, node });
    if (member.kind === SymbolKind.Field && modifiersOf(member).includes('fixed')) checkFixedBuffer(member, type, isUnsafe, { core, evaluate, add });
  }
  return results;
}

function checkFixedBuffer(field, type, isUnsafe, { evaluate, add }) {
  const declarator = field.syntax,
    size = declarator.argumentList?.arguments?.[0]?.expression ?? null,
    element = field.type;
  if (type.typeKind !== TypeKind.Struct) add(DiagnosticId.CS1642, [], declarator.identifier);
  else if (!isUnsafe) add(DiagnosticId.CS0214, [], declarator.identifier);
  if (element && !element.isErrorType() && !bufferElementTypes.has(element.specialType)) add(DiagnosticId.CS1663, [], field.typeSyntax);
  if (size) {
    const bound = evaluate(size, field.scope);
    if (!bound.errors && bound.constant?.isIntegral && bound.constant.bigint <= 0n) add(DiagnosticId.CS1665, [], size);
  }
  // Naming the buffer yields a pointer to its first element.
  if (element && !isPointerType(element)) {
    field.typeWithAnnotations = field.typeWithAnnotations.withType?.(new PointerTypeSymbol(element)) ?? wrap(field, new PointerTypeSymbol(element));
    field.isFixedSizeBuffer = true;
    // Its elements are written through the pointer: the field is not "never assigned".
    field.writes = (field.writes ?? 0) + 1;
    field.nonConstantWrite = true;
  }
}

function wrap(field, type) {
  const Wrapper = field.typeWithAnnotations.constructor;
  return new Wrapper(type);
}

/** Class mixin of the semantic analysis: the unsafe rules of every source type. */
export const UnsafeDeclarationChecks = Base =>
  class extends Base {
    checkUnsafeDeclarations() {
      const options = {
        allowUnsafe: !!this.options.allowUnsafe,
        core: this.core,
        evaluate: (syntax, scope) => this.evaluateConstant(syntax, scope, null, this.core.int),
      };
      for (const type of this.assembly.types) {
        if (type.typeKind === TypeKind.Enum) continue;
        for (const found of checkUnsafeDeclarations(type, options)) {
          if (found.feature) this.gate(found.uri, found.node, found.feature);
          else this.report(found.uri, found.node, found.code, found.args);
        }
      }
    }
  };
