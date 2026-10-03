import {CilError} from './binary.js';

/** Split a CLI display signature without confusing nested generic arguments. */
export function genericTypeParts(name) {
  const open = name.indexOf('<');
  if (open < 0 || !name.endsWith('>')) return {definition: name, arguments: []};
  const argumentsList = []; let depth = 0, start = open + 1;
  for (let i = start; i < name.length - 1; i++) {
    if (name[i] === '<' || name[i] === '[') depth++;
    if (name[i] === '>' || name[i] === ']') depth--;
    if (name[i] === ',' && depth === 0) { argumentsList.push(name.slice(start, i).trim()); start = i + 1; }
  }
  argumentsList.push(name.slice(start, -1).trim());
  return {definition: name.slice(0, open), arguments: argumentsList};
}
export function substituteTypeArguments(type, argumentsList = []) {
  return type.replace(/!!?\d+/g, variable => variable.startsWith('!!') ? variable : argumentsList[Number(variable.slice(1))] ?? variable);
}

/** Resolve fields on closed internal generic types without enabling external storage. */
export function resolveExecutionField(inspector, token, contextArguments = []) {
  const member = inspector.resolveToken(token);
  if (member.kind !== 'field') throw new CilError('Expected a field token');
  const ownerInstance = substituteTypeArguments(member.owner, contextArguments);
  const owner = genericTypeParts(ownerInstance);
  let definition = member.token >>> 24 === 4 ? inspector.fields.get(member.token) : member.resolvedToken ? inspector.fields.get(member.resolvedToken) : null;
  if (!definition) {
    const type = inspector.types.find(type => type.name === owner.definition);
    if (type) {
      const referenceType = substituteTypeArguments(member.signature.type, owner.arguments.length ? owner.arguments : contextArguments);
      const candidates = type.fields.filter(field => field.name === member.name && substituteTypeArguments(inspector.signature(field.token).type, owner.arguments) === referenceType);
      if (candidates.length !== 1) throw new CilError('Field reference has no unique internal declaration');
      definition = candidates[0];
    }
  }
  if (!definition) throw new CilError('External fields are inspection-only');
  const declaredType = inspector.signature(definition.token).type;
  const type = substituteTypeArguments(declaredType, owner.arguments.length ? owner.arguments : contextArguments);
  const volatileModifier = ' modreq(System.Runtime.CompilerServices.IsVolatile)';
  return {...member, ...definition, kind: 'field', resolvedToken: definition.token,
    ownerInstance: owner.arguments.length ? ownerInstance : null,
    genericArguments: owner.arguments, volatile: type.includes(volatileModifier),
    signature: {...member.signature, type: type.replace(volatileModifier, '')}};
}
