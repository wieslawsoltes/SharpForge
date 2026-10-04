import {sourceObjectSlot} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {decodeCoded} from './metadata/indices.js';
import {decodeSignature} from './metadata/signatures.js';
import {frameworkAssemblyScope, approvedFrameworkAssembly} from './metadata/framework-type-identity.js';
const getType = Object.freeze({owner: 'object', name: 'GetType', result: 'System.Type', parameters: [], instance: true});
const toString = Object.freeze({owner: 'object', name: 'ToString', result: 'string', parameters: [], instance: true});
const referenceEquals = Object.freeze({owner: 'System.Object', name: 'ReferenceEquals', result: 'bool',
  parameters: ['object', 'object'], instance: false});
const typeNames = Object.freeze({'System.Int32': 'int', 'System.Double': 'double', 'System.Boolean': 'bool', 'System.Int64': 'long'});
const objectAssemblies = Object.freeze(['System.Runtime', 'System.Private.CoreLib', 'mscorlib']);

/** Emit Object allocation and virtual members distinctly from static Convert calls. */
export function emitObjectBuiltin(context, writer, name, types, adapt) {
  if (name === 'object.new') {
    adapt(types, []);
    writer.op('newobj', context.external('System.Object', '.ctor', 'void', [], false));
    return true;
  }
  let target;
  if (name === 'object.ToString') target = toString;
  else if (name === 'object.Equals') target = {owner: 'object', name: 'Equals', result: 'bool', parameters: ['object'], instance: true};
  else if (name === 'object.GetHashCode') target = {owner: 'object', name: 'GetHashCode', result: 'int', parameters: [], instance: true};
  else if (name === 'object.ReferenceEquals') target = referenceEquals;
  else if (name === 'object.GetType' || name.startsWith('$type.')) target = getType;
  else return false;
  adapt(types, [...(target.instance ? ['object'] : []), ...target.parameters]);
  writer.op(target.instance ? 'callvirt' : 'call',
    context.external(target.owner, target.name, target.result, target.parameters, !target.instance));
  return true;
}

/** Preserve emitted Object identities; static Convert(object) must never become a virtual Object call. */
export function decodeObjectBuiltin(target, call, span, metadata) {
  if (target.owner !== 'System.Object') return null;
  if (target.name === '.ctor') {
    const signature = target.sig;
    if (call.name !== 'newobj' || span.length !== 1 || span[0] !== call || call.operand !== target.token ||
        signature?.kind !== 'method' || signature.isStatic !== false || signature.returnType !== 'void' ||
        signature.parameters.length !== 0 || signature.genericArity || signature.callingConvention ||
        signature.explicitThis || signature.sentinel != null) return null;
    if (target.token >>> 24 !== 10 || !metadata) return null;
    const member = metadata.row(target.token), raw = decodeSignature(metadata.blob(member[2]));
    if (raw.kind !== 'method' || !raw.hasThis || raw.explicitThis || raw.callingConvention !== 0 ||
        raw.genericArity !== 0 || raw.sentinel !== -1 || raw.parameters.length !== 0 ||
        raw.returnType.kind !== 'primitive' || raw.returnType.name !== 'void') return null;
    const ownerToken = decodeCoded('MemberRefParent', member[0]);
    const scope = frameworkAssemblyScope(metadata, ownerToken, target.owner, 'Object constructor');
    if (!scope || !approvedFrameworkAssembly(metadata, scope, objectAssemblies)) {
      throw new CilError('Object constructor has an unapproved assembly identity');
    }
    return 'object.new';
  }
  if (call.name === 'callvirt' && sourceObjectSlot({name: target.name, ...target.sig})) return 'object.' + target.name;
  if (target.name === 'ReferenceEquals') return 'object.ReferenceEquals';
  if (target.name !== 'GetType') return null;
  const box = span.find(instruction => instruction.name === 'box');
  const type = box ? typeNames[metadata.typeName(box.operand)] : null;
  return type ? '$type.' + type + '.GetType' : 'object.GetType';
}
