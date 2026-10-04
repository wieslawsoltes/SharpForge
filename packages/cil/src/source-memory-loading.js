import {Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {memoryTypeName} from './source-memory-types.js';
import {decodeSourceArrayBuiltin, memoryBuiltin} from './source-array-builtin-mapping.js';

const opcodes = new Set(['ldarga', 'ldarga.s', 'ldflda', 'ldsflda', 'ldelema', 'readonly.', 'ldobj', 'stobj',
  'initobj', 'sizeof', 'localloc', 'conv.ovf.u', 'mul.ovf.un']);
export const isSourceMemoryOpcode = name => opcodes.has(name);
const emit = (op, a = 0, b = 0) => [op, a, b];
const builtin = operation => {
  const entry = memoryBuiltin(operation);
  return emit(Op.BUILTIN, entry.id, entry.min);
};
const local = (instruction, name) => instruction?.name === name || instruction?.name === name + '.s' ? instruction.operand : null;
const isSpan = name => /^System\.(?:ReadOnly)?Span(?:`1)?</.test(name);
const typeAt = (context, instruction) => memoryTypeName(context.metadata.typeName(instruction.operand));

function decodeCall(span, c, call) {
  const target = c.resolveCall(call.operand), entry = decodeSourceArrayBuiltin(target);
  if (entry) return emit(Op.BUILTIN, entry.id, entry.min);
  const owner = memoryTypeName(target.owner), names = span.map(instruction => instruction.name);
  if (target.owner === 'System.Type' && target.name === 'GetTypeFromHandle' && names[0] === 'pop' && names.includes('ldtoken'))
    return builtin('typeOf');
  if (target.owner === 'System.String' && target.name === 'op_Implicit' && names[0] === 'pop') return builtin('spanFromString');
  const array = /^(.*)\[([,]+)\]$/.exec(owner);
  if (array) {
    const rank = array[2].length + 1;
    if (target.name === '.ctor' && call.name === 'newobj') return emit(Op.NEWRECT, c.intern(array[1]), rank);
    if (target.name === 'Get') return emit(Op.LDRECT, rank);
    if (target.name === 'Set') return emit(Op.STRECT, rank);
    if (target.name === 'Address') return emit(Op.RECTADDR, rank);
  }
  if (!isSpan(owner)) return null;
  if (target.name === '.ctor' && names.includes('localloc')) {
    const size = span.find(instruction => instruction.name === 'sizeof');
    if (!size) throw new CilError('Stack allocation has no element size');
    return emit(Op.STACKALLOC, c.intern(typeAt(c, size)));
  }
  if (target.name === 'get_Item') return emit(names.includes('stobj') ? Op.SPANSET : names.includes('ldobj') ? Op.SPANGET : Op.SPANADDR);
  if (target.name === 'get_Length') return emit(Op.SPANLENGTH);
  if (target.name === 'Slice') return emit(Op.SPANSLICE, 0, target.sig.parameters.length);
  if (target.name === 'ToArray') return builtin('spanToArray');
  if (target.name === 'op_Implicit') return names[0] === 'pop' ? builtin('spanFromArray') : emit(Op.SPANREADONLY);
  return null;
}

function decodeAddress(span, c) {
  const readonly = span.at(-1)?.name === 'pop' && span.at(-2)?.name === 'ldc.i4' && span.at(-2).operand === 256;
  const body = readonly ? span.slice(0, -2) : span, flag = readonly ? 0x100 : 0;
  if (readonly && body.length === 2 && body[0].name === 'dup' && body[1].name === 'pop') return emit(Op.ADDRESS, 5 | flag);
  const arg = local(body[0], 'ldarga'), slot = local(body[0], 'ldloca');
  if (arg !== null) return emit(Op.ADDRESS, flag, arg);
  if (slot !== null && body.length === 1) return emit(Op.ADDRESS, 1 | flag, slot);
  const instruction = body.find(item => ['ldflda', 'ldsflda', 'ldelema'].includes(item.name));
  if (!instruction) return null;
  if (instruction.name === 'ldelema') return emit(Op.ADDRESS, 3 | flag, c.intern(typeAt(c, instruction)));
  const field = instruction.name === 'ldsflda' ? c.staticByToken.get(instruction.operand) : c.fieldByToken.get(instruction.operand)?.index;
  if (field === undefined) throw new CilError('Unknown address field token');
  return emit(Op.ADDRESS, (instruction.name === 'ldsflda' ? 2 : 4) | flag, field);
}

/** These recognized spans still undergo complete byte-for-byte canonical re-emission. */
export function decodeSourceMemorySpan(span, c) {
  const call = span.find(instruction => ['call', 'callvirt', 'newobj'].includes(instruction.name));
  if (call) return decodeCall(span, c, call);
  if (span.length === 2 && span[0].name === 'pop' && span[1].name === 'castclass') return builtin('cast');
  const init = span.find(instruction => instruction.name === 'initobj');
  if (init && isSpan(typeAt(c, init))) return emit(Op.SPANDEFAULT, c.intern(typeAt(c, init)));
  const indirect = span.find(instruction => instruction.name === 'ldobj' || instruction.name === 'stobj');
  if (indirect) return emit(indirect.name === 'ldobj' ? Op.LDIND : Op.STIND, c.intern(typeAt(c, indirect)));
  return decodeAddress(span, c);
}
