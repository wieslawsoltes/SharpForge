/**
 * Declaration rules for C# 6 member bodies (SF-A02-T62): expression bodies and auto-property initializers.
 *
 *   CS8057  a member has both a block body (or an accessor list) and an expression body
 *   CS8051  an auto-implemented property has no get accessor
 *   CS8053  an instance property of an interface has an initializer
 *
 * Binding the bodies themselves, and running initializers in declaration order before the constructor body, is
 * done where every member body is bound (semantic/body-binding.js) and lowered (codegen/semantic/initialization.js).
 */
import { SymbolKind, TypeKind } from '../symbols/types.js';

const hasBlockAndExpressionBody = syntax => !!syntax?.expressionBody && !!(syntax.body ?? syntax.accessorList);

/** True for an accessor without a body in a property the compiler implements. */
const isAutoAccessor = accessor => !!accessor && !accessor.hasBody && !accessor.isAbstract && !accessor.isExtern;

function propertyRows(type, property) {
  const rows = [],
    syntax = property.syntax,
    inInterface = type.typeKind === TypeKind.Interface;
  if (hasBlockAndExpressionBody(syntax)) rows.push({ member: property, code: 'CS8057', args: [], at: syntax });
  if (!inInterface && !property.getMethod && isAutoAccessor(property.setMethod) && !property.isIndexer) {
    rows.push({ member: property, code: 'CS8051', args: [], at: property.setMethod.syntax?.keyword });
  }
  if (inInterface && !property.isStatic && syntax.initializer) rows.push({ member: property, code: 'CS8053', args: [] });
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
    else if (member.kind === SymbolKind.Method && !member.isAccessor && hasBlockAndExpressionBody(member.syntax)) {
      rows.push({ member, code: 'CS8057', args: [], at: member.syntax });
    }
  }
  return rows;
}
