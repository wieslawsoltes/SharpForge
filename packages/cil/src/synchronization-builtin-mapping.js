import {codedIndex} from './metadata.js';
import {methodSignature, methodSpecSignature} from './metadata/signature-members.js';
import {CilError} from './binary.js';

/** Generic atomic operations emit their open MemberRef plus an exact closed MethodSpec. */
export function emitGenericSynchronization(context, writer, descriptor, types, adapt) {
  const location = types[0];
  if (typeof location !== 'string' || !location.endsWith('&')) throw new CilError('Synchronization requires a typed managed address');
  const type = location.slice(0, -1), parameters = descriptor.parameters.map(parameter => parameter.replace(/!!0/g, type));
  adapt(types, parameters);
  const signature = methodSignature(descriptor.returnType, descriptor.parameters, true,
    context.resolveType, {genericArity: descriptor.genericArity});
  const member = context.metadata.member(context.resolveType(descriptor.owner), descriptor.name, signature);
  const token = context.metadata.add(43, [codedIndex('MethodDefOrRef', member),
    context.metadata.blob(methodSpecSignature([context.signatures.type(type)]))]);
  writer.op('call', token);
  if (descriptor.returnType === 'void') writer.op('ldnull');
}
