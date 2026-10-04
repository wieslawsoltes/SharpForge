import {Op, Builtins} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {arrayElementType, spanElementType, valueTypeName} from './source-memory-types.js';
import {emitSourceArrayBuiltin} from './source-array-builtin-mapping.js';

function emitAddress(w, c, {a, b, input}) {
  const kind = a & 255, readonly = !!(a & 0x100);
  if (kind === 0) w.local('ldarga', b);
  else if (kind === 1) w.local('ldloca', b);
  else if (kind === 2) w.op('ldsflda', c.staticTokens[b]);
  else if (kind === 3) {
    if (readonly) w.op('readonly.');
    w.op('ldelema', c.resolveType(c.image.constants[b]));
  } else if (kind === 4) {
    const field = c.fieldTokens.get(valueTypeName(input.at(-1)) + ':' + b);
    if (!field) throw new CilError('Unknown addressed field');
    w.op('ldflda', field);
  } else if (kind === 5) w.op('dup').op('pop');
  else throw new CilError('Invalid managed address kind');
  if (readonly) w.integer(256).op('pop');
}

function emitRectangular(w, c, instruction) {
  const {op, a, b, input, getScratch, adapt} = instruction;
  if (op === Op.NEWRECT) {
    const array = c.image.constants[a] + '[' + ','.repeat(b - 1) + ']';
    w.op('newobj', c.external(array, '.ctor', 'void', Array(b).fill('int'), false));
    return;
  }
  const store = op === Op.STRECT, owner = input.at(-(a + (store ? 2 : 1))), type = arrayElementType(owner);
  const name = store ? 'Set' : op === Op.RECTADDR ? 'Address' : 'Get';
  const parameters = [...Array(a).fill('int'), ...(store ? [type] : [])];
  const result = store ? 'void' : type + (op === Op.RECTADDR ? '&' : '');
  let value;
  if (store) {
    adapt([input.at(-1)], [type]);
    value = getScratch(type, 990); w.local('stloc', value).local('ldloc', value);
  }
  w.op('call', c.external(owner, name, result, parameters, false));
  if (store) w.local('ldloc', value);
}

function emitStackAllocation(w, c, {a, getScratch}) {
  const type = c.image.constants[a], length = getScratch('int', 991);
  w.local('stloc', length).local('ldloc', length).op('conv.ovf.u');
  w.op('sizeof', c.resolveType(type)).op('mul.ovf.un').op('localloc').local('ldloc', length);
  w.op('newobj', c.external('System.Span<' + type + '>', '.ctor', 'void', ['void*', 'int'], false));
}

/** Value receiver calls spill their operands, then load the receiver's address. */
export function spanReceiver(w, types, getScratch) {
  const slots = types.map((type, index) => getScratch(type, 992 + index));
  for (let index = slots.length - 1; index >= 0; index--) w.local('stloc', slots[index]);
  w.local('ldloca', slots[0]);
  for (let index = 1; index < slots.length; index++) w.local('ldloc', slots[index]);
  return slots;
}

function emitSpan(w, c, instruction) {
  const {op, a, b, input, getScratch, adapt} = instruction;
  if (op === Op.SPANDEFAULT) {
    const type = c.image.constants[a], slot = getScratch(type, 991);
    w.local('ldloca', slot).op('initobj', c.resolveType(type)).local('ldloc', slot); return;
  }
  if (op === Op.SPANREADONLY) {
    w.op('call', c.external(valueTypeName(input.at(-1)), 'op_Implicit', 'System.ReadOnlySpan<!0>', ['System.Span<!0>']));
    return;
  }
  const count = op === Op.SPANSLICE ? b + 1 : op === Op.SPANLENGTH ? 1 : op === Op.SPANSET ? 3 : 2;
  const types = input.slice(-count), owner = valueTypeName(types[0]), element = spanElementType(owner);
  let value;
  if (op === Op.SPANSET) {
    adapt([types.at(-1)], [element]); value = getScratch(element, 999);
    w.local('stloc', value); types.pop();
  }
  spanReceiver(w, types, getScratch);
  if (op === Op.SPANSLICE) {
    const template = owner.slice(0, owner.indexOf('<')) + '<!0>';
    w.op('call', c.external(owner, 'Slice', template, Array(b).fill('int'), false));
  } else if (op === Op.SPANLENGTH) w.op('call', c.external(owner, 'get_Length', 'int', [], false));
  else {
    w.op('call', c.external(owner, 'get_Item', '!0&', ['int'], false));
    if (op === Op.SPANGET) w.op('ldobj', c.resolveType(element));
    else if (op === Op.SPANSET) w.local('ldloc', value).op('stobj', c.resolveType(element)).local('ldloc', value);
  }
}

export function emitSourceMemoryInstruction(w, c, instruction) {
  const {op, a, input, getScratch, adapt} = instruction;
  switch (op) {
    case Op.ADDRESS: emitAddress(w, c, instruction); break;
    case Op.LDIND: w.op('ldobj', c.resolveType(c.image.constants[a])); break;
    case Op.STIND: {
      const type = c.image.constants[a], value = getScratch(type, 990);
      adapt([input.at(-1)], [type]);
      w.local('stloc', value).local('ldloc', value).op('stobj', c.resolveType(type)).local('ldloc', value); break;
    }
    case Op.NEWRECT: case Op.LDRECT: case Op.STRECT: case Op.RECTADDR: emitRectangular(w, c, instruction); break;
    case Op.STACKALLOC: emitStackAllocation(w, c, instruction); break;
    case Op.SPANGET: case Op.SPANSET: case Op.SPANADDR: case Op.SPANSLICE:
    case Op.SPANLENGTH: case Op.SPANREADONLY: case Op.SPANDEFAULT: emitSpan(w, c, instruction); break;
    case Op.BUILTIN:
      if (!Builtins[a]?.arrayRuntime) return false;
      emitSourceArrayBuiltin(w, c, instruction); break;
    default: return false;
  }
  return true;
}
