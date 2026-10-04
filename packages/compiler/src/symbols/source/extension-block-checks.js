/**
 * Declaration rules of C# 14 extension blocks (SF-A02-T83), reported where Roslyn reports them:
 *
 *   CS9283  the block is not in a top-level, non-generic, static class          (the `extension` keyword)
 *   CS9284  a default value on the receiver parameter                           (the parameter)
 *   CS9285  more than one receiver parameter                                    (each extra parameter)
 *   CS9300  a `ref` receiver that is not a value type or struct-constrained     (the receiver type)
 *   CS9301  an `in` / `ref readonly` receiver that is not a concrete value type (the receiver type)
 *   CS9282  a member that is not a method, a property with accessor bodies or an operator (its name)
 *   CS9302  a protected member, CS9303 an instance member of a block without a receiver name,
 *   CS9304  an init accessor, CS9326 a member named like the extended type,
 *   CS9295  a property that leaves a type parameter of the block unreferenced by the receiver type,
 *   CS9287, CS9290, CS9291, CS9292  a type parameter, parameter or `value` that collides with the receiver name
 *   CS9317, CS9319  an operator none of whose parameters has the extended type
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { TypeKind } from '../types.js';
import { canDeclareExtensions } from '../../overload/extension-methods.js';
import { containsTypeParameter } from '../substitution.js';
import { words } from './source-type.js';

const typeDeclarations = new Set([
  'ClassDeclaration',
  'StructDeclaration',
  'InterfaceDeclaration',
  'EnumDeclaration',
  'DelegateDeclaration',
  'RecordDeclaration',
  'RecordStructDeclaration',
]);

/** The token Roslyn names for a member that an extension block cannot contain, or null when the member is allowed. */
export function disallowedMemberToken(member) {
  switch (member.kind) {
    case 'MethodDeclaration':
    case 'OperatorDeclaration':
      return null;
    case 'PropertyDeclaration': {
      const accessors = member.accessorList?.accessors ?? [],
        isAuto = !member.expressionBody && accessors.every(accessor => !accessor.body && !accessor.expressionBody);
      return isAuto ? member.identifier : null;
    }
    case 'IndexerDeclaration': {
      // C# 15 preview (the parser gates it below): like a property, an indexer needs accessor bodies.
      const accessors = member.accessorList?.accessors ?? [],
        isAuto = !member.expressionBody && accessors.every(accessor => !accessor.body && !accessor.expressionBody);
      return isAuto ? member.thisKeyword : null;
    }
    case 'FieldDeclaration':
    case 'EventFieldDeclaration':
      return member.declaration.variables[0]?.identifier ?? member;
    case 'ConversionOperatorDeclaration':
      return member.type;
    default:
      return typeDeclarations.has(member.kind) || member.identifier ? (member.identifier ?? member) : null;
  }
}

/** The rules of the block itself: its container and its receiver parameter list. */
export function checkExtensionBlock(type, block, report) {
  if (!canDeclareExtensions(type)) report(block.firstToken(), DiagnosticId.CS9283);
  const [receiver, ...extras] = block.parameterList?.parameters ?? [];
  // Roslyn reports the default value on the receiver only; an extra parameter is CS9285 whatever it declares.
  if (receiver?.default) report(receiver, DiagnosticId.CS9284);
  for (const extra of extras) report(extra, DiagnosticId.CS9285);
  checkExtensionReceiverName(block, report);
}

/** The rules of the receiver parameter once its type is bound. */
export function checkExtensionReceiver(receiver, report) {
  const syntax = receiver?.syntax,
    modifiers = syntax ? words(syntax.modifiers ?? []) : [],
    type = receiver?.type;
  if (!type || !syntax?.type) return;
  const isStructParameter = type.typeKind === TypeKind.TypeParameter && type.hasValueTypeConstraint === true;
  if (modifiers.includes('in') || (modifiers.includes('ref') && modifiers.includes('readonly'))) {
    if (type.isValueType !== true || type.typeKind === TypeKind.TypeParameter) report(syntax.type, DiagnosticId.CS9301);
  } else if (modifiers.includes('ref') && type.isValueType !== true && !isStructParameter) report(syntax.type, DiagnosticId.CS9300);
}

/** CS9287: the receiver parameter is named like a type parameter of its block. */
export function checkExtensionReceiverName(block, report) {
  const receiver = block.parameterList?.parameters[0]?.identifier,
    name = receiver && !receiver.isMissing ? receiver.valueText : null;
  if (name && (block.typeParameterList?.parameters ?? []).some(parameter => parameter.identifier.valueText === name)) report(receiver, DiagnosticId.CS9287, [name]);
}

/**
 * The rules of one allowed member.
 * @param {{name:string, isStatic:boolean, receiver:object|null, display:string, blockTypeParameters:object[]}} context
 *   `receiver` is the bound receiver parameter; `display` is the member as Roslyn names it in messages
 */
export function checkExtensionMember(member, context, report) {
  const modifiers = words(member.modifiers ?? []),
    receiver = context.receiver,
    // An extension indexer (C# 15 preview) has no identifier: its rules are reported at `this`.
    at = member.identifier ?? member.thisKeyword;
  if (modifiers.includes('protected')) report(at, DiagnosticId.CS9302, [context.display]);
  if (!context.isStatic && receiver && !receiver.name) report(at, DiagnosticId.CS9303, [context.display]);
  const extended = receiver?.type;
  if (extended?.name && extended.name === context.name) report(at, DiagnosticId.CS9326, [context.display]);
  if (receiver?.name) {
    for (const parameter of member.parameterList?.parameters ?? [])
      if (parameter.identifier?.valueText === receiver.name) report(parameter.identifier, DiagnosticId.CS9290, [receiver.name]);
    for (const parameter of member.typeParameterList?.parameters ?? [])
      if (parameter.identifier.valueText === receiver.name) report(parameter.identifier, DiagnosticId.CS9292, [receiver.name]);
  }
  if (member.kind !== 'PropertyDeclaration' && member.kind !== 'IndexerDeclaration') return;
  for (const accessor of member.accessorList?.accessors ?? []) {
    if (accessor.keyword.text === 'init') report(accessor.keyword, DiagnosticId.CS9304, [context.display]);
    else if (accessor.keyword.text === 'set' && receiver?.name === 'value') report(accessor.keyword, DiagnosticId.CS9291);
  }
  // "all the type parameters of its extension block must be used in the combined set of parameters from the
  // extension and the member" (extension-indexers.md revision 1, "Declaration"); a property has no parameters.
  const usedBy = parameter => [extended, ...(context.ownParameters ?? []).map(own => own.type)].some(type => type && containsTypeParameter(type, [parameter]));
  for (const parameter of context.blockTypeParameters) if (!usedBy(parameter)) report(at, DiagnosticId.CS9295, [parameter.name]);
}

/** CS9317 / CS9319: a parameter of an extension operator must have the extended type; CS0558: public and static. */
export function checkExtensionOperator(member, implementation, report) {
  const extended = implementation.extensionReceiverType,
    modifiers = words(member.modifiers ?? []);
  const isStatic = modifiers.includes('static'),
    token = member.operatorToken.text;
  // Instance operators exist for compound assignment and increment only (C# 14); they follow other rules.
  if (!isStatic && (token === '++' || token === '--' || (token.endsWith('=') && !['==', '!=', '<=', '>='].includes(token)))) return;
  if (!isStatic || !modifiers.includes('public')) report(member.operatorToken, DiagnosticId.CS0558, [implementation.toDisplayString()]);
  if (!extended || implementation.parameters.some(parameter => parameter.type?.equals(extended))) return;
  report(member.operatorToken, implementation.parameters.length === 1 ? DiagnosticId.CS9317 : DiagnosticId.CS9319);
}
