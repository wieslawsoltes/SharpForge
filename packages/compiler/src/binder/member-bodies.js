/**
 * Declaration rules for C# 6 member bodies (SF-A02-T62): expression bodies and auto-property initializers.
 *
 *   CS8057  a member or an accessor has both a block body (or an accessor list) and an expression body
 *           (a local function with both is reported where it is declared, binder/body/local-functions.js)
 *   CS8051  an auto-implemented property has no get accessor
 *   CS8053  an instance property of an interface has an initializer
 *
 * Binding the bodies themselves, and running initializers in declaration order before the constructor body, is
 * done where every member body is bound (semantic/body-binding.js) and lowered (codegen/semantic/initialization.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';

const hasBlockAndExpressionBody = syntax => !!syntax?.expressionBody && !!(syntax.body ?? syntax.accessorList);

/** One CS8057 row for each accessor of a property, indexer or event that has both bodies. */
function accessorRows(member) {
  const accessors = [...(member.syntax.accessorList?.accessors ?? [])];
  return accessors.filter(hasBlockAndExpressionBody).map(accessor => ({ member, code: DiagnosticId.CS8057, args: [], at: accessor }));
}

/** True for an accessor without a body in a property the compiler implements. */
const isAutoAccessor = accessor => !!accessor && !accessor.hasBody && !accessor.isAbstract && !accessor.isExtern;

function propertyRows(type, property) {
  const rows = [],
    syntax = property.syntax,
    inInterface = type.typeKind === TypeKind.Interface;
  if (hasBlockAndExpressionBody(syntax)) rows.push({ member: property, code: DiagnosticId.CS8057, args: [], at: syntax });
  rows.push(...accessorRows(property));
  if (!inInterface && !property.getMethod && isAutoAccessor(property.setMethod) && !property.isIndexer) {
    rows.push({ member: property, code: DiagnosticId.CS8051, args: [], at: property.setMethod.syntax?.keyword });
  }
  if (inInterface && !property.isStatic && syntax.initializer) rows.push({ member: property, code: DiagnosticId.CS8053, args: [] });
  return rows;
}

/**
 * The member-body rule of one source type.
 * @returns {object[]} rows `{ member, code, args, at? }` (see binder/members/declaration-checks.js)
 */
export function checkMemberBodies(type) {
  const rows = [];
  for (const member of type.getMembers()) {
    if (member.isImplicitlyDeclared || !member.syntax) continue;
    if (member.kind === SymbolKind.Property) rows.push(...propertyRows(type, member));
    else if (member.kind === SymbolKind.Event) rows.push(...accessorRows(member));
    else if (member.kind === SymbolKind.Method && !member.isAccessor && hasBlockAndExpressionBody(member.syntax)) {
      rows.push({ member, code: DiagnosticId.CS8057, args: [], at: member.syntax });
    }
  }
  return rows;
}
