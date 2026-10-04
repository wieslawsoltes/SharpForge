import {Binary, BuiltinMap, Op, frameworkBuiltin, numericAliases} from '@sharpforge/bytecode';
import {contractForMember} from '@sharpforge/framework';
import {CilError} from '../binary.js';
import {decodeProfileBuiltin} from '../builtin-emission.js';
import {decodeObjectBuiltin} from '../object-builtin-mapping.js';

export const profileShortTypes = Object.freeze({...numericAliases, 'System.Boolean': 'bool',
  'System.String': 'string', 'System.Object': 'object', 'System.Exception': 'Exception', 'System.Array': 'Array'});

/** Decode source-profile call spans before the loader's full canonical re-emission check. */
export function decodeCallSpan(span, call, context) {
  const emit = (op, a = 0, b = 0) => [op, a, b];
  const target = context.resolveCall(call.operand), owner = profileShortTypes[target.owner] ?? target.owner;
  const signature = target.sig;
  const count = signature.parameters.length + (!signature.isStatic && call.name !== 'newobj' ? 1 : 0);
  const entry = decodeProfileBuiltin(target, span);
  if (entry) return emit(Op.BUILTIN, entry.id, count);
  const contract = contractForMember({owner: target.owner, name: target.name, signature});
  if (contract) {
    const builtin = frameworkBuiltin(contract);
    return emit(Op.BUILTIN, builtin.id, builtin.min);
  }
  if (call.name === 'newobj' && signature.parameters[0] === 'SharpForge.<>AllocationToken') {
    const type = context.typeByToken.get(context.typeOwners.get(call.operand));
    if (!type) throw new CilError('Unknown allocation constructor');
    return emit(Op.NEWOBJ, type.id);
  }
  if (context.methodByToken.has(call.operand)) {
    return emit(Op.CALL, context.methodByToken.get(call.operand).id, count);
  }
  if (target.name === '<assert>' && target.owner === 'SharpForge.<>Program') {
    return emit(Op.BUILTIN, BuiltinMap.get('Debug.Assert').id, span.some(instruction => instruction.name === 'ldstr') ? 1 : 2);
  }
  if (owner === 'string' && target.name === 'Concat' && signature.parameters[0] === 'object') return emit(Op.BINARY, Binary['+'], 2);
  if (owner === 'string' && target.name.startsWith('op_')) {
    if (!['op_Equality', 'op_Inequality'].includes(target.name)) throw new CilError('Unsupported string operator');
    return emit(Op.BINARY, Binary[target.name === 'op_Equality' ? '==' : '!=']);
  }
  if (owner === 'string' && target.name === 'get_Length') return emit(Op.LENGTH);
  let name = decodeObjectBuiltin(target, call, span, context.metadata), argc = count;
  if (name) return emit(Op.BUILTIN, BuiltinMap.get(name).id, argc);
  if (owner === 'Exception' && target.name === '.ctor' && call.name === 'newobj') {
    name = 'Exception.new';
    argc = signature.parameters.length;
  } else if (owner === 'Exception' && target.name === 'get_Message') name = 'Exception.Message';
  else if (target.owner === 'System.Math') {
    name = 'Math.' + target.name;
    if (target.name === 'Abs' && signature.parameters[0] === 'int') name = '$Math.Abs.Int32';
  } else if (target.owner === 'System.Console') name = 'Console.' + target.name;
  else if (target.owner === 'System.GC') {
    name = 'GC.' + target.name;
    if (target.name === 'GetTotalMemory' && span.some(instruction => instruction.name.startsWith('ldc.i4'))) argc = 0;
  } else if (target.owner === 'System.Convert') name = 'Convert.' + target.name;
  else if (['System.Type', 'System.Reflection.MemberInfo'].includes(target.owner) && ['get_Name', 'get_FullName'].includes(target.name)) {
    name = 'Type.' + target.name.slice(4);
  } else if (target.owner === 'System.Enum' && target.name === 'HasFlag') name = 'Enum.HasFlag';
  else if (target.owner === 'System.Environment' && target.name === 'get_TickCount') name = 'Environment.TickCount';
  else if (owner === 'int' || owner === 'double' || owner === 'string' || owner === 'Array') name = owner + '.' + target.name;
  const builtin = BuiltinMap.get(name);
  if (!builtin) throw new CilError(`External method is not in the browser runtime profile: ${target.owner}.${target.name}`);
  return emit(Op.BUILTIN, builtin.id, argc);
}
