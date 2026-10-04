import {CilError} from './binary.js';
import {token} from './metadata.js';
import {genericTypeParts} from './field-profile.js';
import {callSignatureKey, instantiateSignature, normalizeCallType} from './call-profile.js';

const stateMachine = 'System.Runtime.CompilerServices.IAsyncStateMachine';
const enumerable = 'System.Collections.IEnumerable', enumerator = 'System.Collections.IEnumerator';
const generic = 'System.Collections.Generic.';
const methods = new Map([
  [stateMachine, [['MoveNext', 'void', []], ['SetStateMachine', 'void', [stateMachine]]]],
  ['System.IDisposable', [['Dispose', 'void', []]]],
  [enumerator, [['MoveNext', 'bool', []], ['Reset', 'void', []], ['get_Current', 'object', []]]],
  [enumerable, [['GetEnumerator', enumerator, []]]],
  [generic + 'IEnumerator`1', [['get_Current', '!0', []]]],
  [generic + 'IEnumerable`1', [['GetEnumerator', generic + 'IEnumerator`1<!0>', []]]],
]);
const members = new WeakMap();

/** Only the exact runtime-supported state-machine interface contracts can acquire external slots. */
export function frameworkInterfaceDefinition(descriptor) {
  if (descriptor?.kind !== 'method' || !descriptor.signature) return null;
  const parts = genericTypeParts(descriptor.ownerInstance ?? descriptor.owner);
  if (parts.arguments.length !== (parts.definition.endsWith('`1') ? 1 : 0)) return null;
  const profile = methods.get(parts.definition)?.find(([name]) => name === descriptor.name);
  if (!profile) return null;
  const signature = instantiateSignature({kind: 'method', isStatic: false, returnType: profile[1], parameters: profile[2]}, parts.arguments);
  if (callSignatureKey(signature) !== callSignatureKey(descriptor.signature)) return null;
  return {...descriptor, signature, flags: 0x446, external: true, ownerInstance: descriptor.ownerInstance ?? descriptor.owner};
}

function interfaceMembers(dispatch) {
  let indexed = members.get(dispatch);
  if (indexed) return indexed;
  indexed = new Map();
  for (let index = 0; index < (dispatch.inspector.metadata.rows[10]?.length ?? 0); index++) {
    const member = dispatch.inspector.resolveToken(token(10, index + 1));
    if (member.kind !== 'method' || member.resolvedToken || !frameworkInterfaceDefinition(member)) continue;
    const owner = genericTypeParts(member.owner).definition;
    if (!indexed.has(owner)) indexed.set(owner, []);
    indexed.get(owner).push(member);
  }
  members.set(dispatch, indexed);
  return indexed;
}

export function externalInterfaceTable(dispatch, context) {
  const {name, arguments: arguments_} = context, parts = genericTypeParts(name);
  const table = {slots: new Map(), aliases: new Map(), declarations: new Map(), declarationDetails: new Map(),
    visible: new Map(), ancestors: new Set(), instances: new Set(), interfaceCandidates: new Map()};
  if (!methods.has(parts.definition)) return table;
  const bases = parts.definition === generic + 'IEnumerator`1' ? [enumerator, 'System.IDisposable']
    : parts.definition === generic + 'IEnumerable`1' ? [enumerable] : [];
  for (const base of bases) {
    const inherited = dispatch.table(base);
    for (const instance of inherited.instances) table.instances.add(instance);
    for (const [key, slot] of inherited.declarations) table.declarations.set(key, slot);
    for (const [key, detail] of inherited.declarationDetails) table.declarationDetails.set(key, detail);
  }
  table.instances.add(name);
  for (const member of interfaceMembers(dispatch).get(parts.definition) ?? []) {
    const owner = genericTypeParts(member.owner);
    if (owner.arguments.length && !owner.arguments.some(argument => /!\d+/.test(argument)) &&
        normalizeCallType(member.owner) !== normalizeCallType(name)) continue;
    const signature = instantiateSignature(member.signature, arguments_);
    const slot = 'external:' + name + '::' + member.name + '::' + callSignatureKey(signature);
    const key = name + '::' + member.token;
    table.declarations.set(key, slot);
    table.declarationDetails.set(key, {token: member.token, name: member.name, owner: name, signature, slot, external: true});
  }
  return table;
}

export function declarationMatches(item, declaration) {
  return declaration.external ? item.external && item.name === declaration.name &&
    callSignatureKey(item.signature) === callSignatureKey(declaration.signature) : item.token === declaration.token;
}

export function externalInterfaceTarget(dispatch, type, descriptor) {
  if (!frameworkInterfaceDefinition(descriptor)) return null;
  const table = dispatch.table(type), owner = normalizeCallType(descriptor.ownerInstance ?? descriptor.owner);
  const candidates = [...table.declarationDetails.values()].filter(item => item.external &&
    normalizeCallType(item.owner) === owner && declarationMatches(item, {...descriptor, external: true}));
  const slots = new Set(candidates.map(item => item.slot));
  if (!slots.size) return null;
  if (slots.size !== 1) throw new CilError('Ambiguous external interface declaration');
  return dispatch.resolveSlot(table, slots.values().next().value) ?? null;
}

export function externalInterfaceTargets(dispatch, descriptor) {
  const targets = new Set();
  for (const type of dispatch.types.values()) {
    if (type.flags & 0xa0) continue;
    const target = externalInterfaceTarget(dispatch, type.token, descriptor);
    if (dispatch.inspector.methods.get(target)?.hasBody) targets.add(target);
  }
  return targets;
}
