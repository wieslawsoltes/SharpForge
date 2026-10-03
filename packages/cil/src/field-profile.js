import {isDecimalConstantField} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {genericTypeParts, substituteTypeArguments, normalizeCallType} from './generic-signatures.js';
export {genericTypeParts, substituteTypeArguments} from './generic-signatures.js';

/** Resolve fields on closed internal generic types without enabling external storage. */
export function resolveExecutionField(inspector, token, contextArguments = [], methodArguments = []) {
  const member = inspector.resolveToken(token);
  if (member.kind !== 'field') throw new CilError('Expected a field token');
  if (member.token >>> 24 === 10 && !member.resolvedToken && isDecimalConstantField(member)) return {...member, isStatic: true, isInitOnly: true,
    decimalConstant: member.name, resolvedToken: member.token, ownerInstance: null, genericArguments: [], volatile: false};
  const ownerInstance = substituteTypeArguments(member.owner, contextArguments, methodArguments);
  const owner = genericTypeParts(ownerInstance);
  let definition = member.token >>> 24 === 4 ? inspector.fields.get(member.token) : member.resolvedToken ? inspector.fields.get(member.resolvedToken) : null;
  if (!definition) {
    const type = inspector.types.find(type => type.name === owner.definition);
    if (type) {
      const referenceType = substituteTypeArguments(member.signature.type, owner.arguments.length ? owner.arguments : contextArguments, methodArguments);
      const candidates = type.fields.filter(field => field.name === member.name && normalizeCallType(substituteTypeArguments(inspector.signature(field.token).type, owner.arguments)) === normalizeCallType(referenceType));
      if (candidates.length !== 1) throw new CilError('Field reference has no unique internal declaration');
      definition = candidates[0];
    }
  }
  if (!definition) throw new CilError('External fields are inspection-only');
  const declaredType = inspector.signature(definition.token).type;
  const type = substituteTypeArguments(declaredType, owner.arguments.length ? owner.arguments : contextArguments, methodArguments);
  const volatileModifier = ' modreq(System.Runtime.CompilerServices.IsVolatile)';
  return {...member, ...definition, kind: 'field', resolvedToken: definition.token,
    ownerInstance: owner.arguments.length ? ownerInstance : null,
    genericArguments: owner.arguments, volatile: type.includes(volatileModifier),
    signature: {...member.signature, type: type.replace(volatileModifier, '')}};
}
