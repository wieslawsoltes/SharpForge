/**
 * Declaration rules of properties, constants, static constructors and parameter lists that the symbol builders do
 * not check (SF-A02-T10.1, SF-A02-T10.3, SF-A02-T03.4, SF-A02-T06.3), as Roslyn reports them:
 *
 *   properties    CS0548  no accessors                       CS0547  type void
 *   constants     CS0504  `static const`
 *   constructors  CS0132  a static constructor with parameters   CS0515  with access modifiers
 *   parameters    CS1737  optional before required           CS0231  `params` not last
 *                 CS0225  `params` of a non-collection type  CS1741  default on ref/out   CS1751  default on `params`
 *
 * Every function returns `{ member, code, args, at? }` rows; `at` is the syntax to report at when it is not the
 * member's name.
 */
import { SymbolKind, RefKind, ArrayTypeSymbol } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';

const accessWords = new Set(['public', 'private', 'protected', 'internal']);
// A field symbol's syntax is its declarator; the modifiers are on the declaration around it.
const modifierTokens = member => member.declarationSyntax?.modifiers ?? member.syntax?.modifiers ?? [];
const keywordOf = (parameter, text) => (parameter.syntax?.modifiers ?? []).find(token => token.text === text);

export function checkPropertyDeclarations(type) {
  const rows = [];
  for (const property of type.getMembers()) {
    if (property.kind !== SymbolKind.Property || property.isImplicitlyDeclared || !property.syntax) continue;
    const display = property.toDisplayString();
    if (!property.getMethod && !property.setMethod && property.syntax.accessorList) rows.push({ member: property, code: 'CS0548', args: [display] });
    if (property.type?.specialType === 'System_Void') rows.push({ member: property, code: 'CS0547', args: [display] });
  }
  return rows;
}

export function checkConstantDeclarations(type) {
  const rows = [];
  for (const field of type.getMembers()) {
    if (field.kind !== SymbolKind.Field || !field.isConst || field.isEnumMember) continue;
    if (modifierTokens(field).some(token => token.text === 'static')) rows.push({ member: field, code: 'CS0504', args: [field.toDisplayString()] });
  }
  return rows;
}

export function checkStaticConstructorDeclarations(type) {
  const rows = [];
  for (const constructor of type.getMembers()) {
    if (constructor.kind !== SymbolKind.Method || constructor.methodKind !== MethodKind.StaticConstructor || !constructor.syntax) continue;
    const display = constructor.toDisplayString();
    if (constructor.parameters.length) rows.push({ member: constructor, code: 'CS0132', args: [display] });
    if (modifierTokens(constructor).some(token => accessWords.has(token.text))) rows.push({ member: constructor, code: 'CS0515', args: [display] });
  }
  return rows;
}

/** A `params` parameter of a predefined non-array type (`params int`) can never be a collection. */
const isCollectionType = type => !type || type.isErrorType?.() || type instanceof ArrayTypeSymbol || !type.specialType;

/** The rules of one parameter list; `list` is its syntax (the closing token carries CS1737). */
function parameterListRows(member, parameters, list) {
  const rows = [];
  let optionalSeen = false,
    orderReported = false;
  parameters.forEach((parameter, index) => {
    const hasDefault = !!parameter.defaultSyntax;
    if (parameter.isParams) {
      if (index !== parameters.length - 1) rows.push({ member, code: 'CS0231', args: [], at: parameter.syntax });
      if (!isCollectionType(parameter.type)) rows.push({ member, code: 'CS0225', args: [], at: keywordOf(parameter, 'params') });
      if (hasDefault) rows.push({ member, code: 'CS1751', args: [], at: keywordOf(parameter, 'params') });
      return;
    }
    if (hasDefault && (parameter.refKind === RefKind.Ref || parameter.refKind === RefKind.Out)) {
      rows.push({ member, code: 'CS1741', args: [], at: keywordOf(parameter, 'ref') ?? keywordOf(parameter, 'out') });
      return;
    }
    if (hasDefault) optionalSeen = true;
    else if (optionalSeen && !orderReported && list) {
      orderReported = true;
      rows.push({ member, code: 'CS1737', args: [], at: list.closeParenToken ?? list.closeBracketToken });
    }
  });
  return rows.filter(row => row.at);
}

export function checkParameterDeclarations(type) {
  const rows = [];
  for (const member of type.getMembers()) {
    if (member.isImplicitlyDeclared || !member.syntax) continue;
    const isMethod = member.kind === SymbolKind.Method && [MethodKind.Ordinary, MethodKind.Constructor].includes(member.methodKind),
      isIndexer = member.kind === SymbolKind.Property && member.parameters?.length;
    if (!isMethod && !isIndexer) continue;
    const list = member.isPrimaryConstructor ? member.syntax : member.syntax.parameterList;
    rows.push(...parameterListRows(member, member.parameters, list));
  }
  return rows;
}
