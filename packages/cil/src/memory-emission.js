import {Op, arrayType, spanType, memoryTypeName} from '@sharpforge/bytecode';

function saveOperands(writer, inputs, scratch) {
  const slots = inputs.map((type, i) => scratch(type, 1200 + i));
  for (let i = slots.length - 1; i >= 0; i--) writer.local('stloc', slots[i]);
  return slots;
}

function emitRectangle(writer, context, instruction) {
  const {op, a, b, input, scratch} = instruction;
  if (op === Op.NEWRECT) {
    const type = context.image.constants[a] + '[' + ','.repeat(b - 1) + ']';
    writer.op('newobj', context.external(type, '.ctor', 'void', Array(b).fill('int'), false));
    return;
  }
  const store = op === Op.STRECT, type = input.at(-a - (store ? 2 : 1)), element = arrayType(type).element;
  const name = store ? 'Set' : op === Op.RECTADDR ? 'Address' : 'Get';
  const parameters = [...Array(a).fill('int'), ...(store ? [element] : [])];
  const result = store ? 'void' : element + (op === Op.RECTADDR ? '&' : '');
  let value;
  if (store) { value = scratch(element, 1299); writer.local('stloc', value).local('ldloc', value); }
  writer.op('call', context.external(type, name, result, parameters, false));
  if (store) writer.local('ldloc', value);
}

function emitStackAllocation(writer, context, instruction) {
  const element = context.image.constants[instruction.a], length = instruction.scratch('int', 1200);
  const type = memoryTypeName('Span<' + element + '>');
  writer.local('stloc', length).local('ldloc', length).op('conv.ovf.u');
  writer.op('sizeof', context.resolveType(element)).op('conv.u').op('mul.ovf.un').op('localloc');
  writer.local('ldloc', length).op('newobj', context.external(type, '.ctor', 'void', ['void*', 'int'], false));
}

function emitSpan(writer, context, instruction) {
  const {op, b, input, scratch} = instruction;
  const count = op === Op.SPANSET ? 3 : [Op.SPANGET, Op.SPANADDR].includes(op) ? 2 : op === Op.SPANSLICE ? b + 1 : 1;
  const types = input.slice(-count), type = types[0], span = spanType(type);
  const slots = saveOperands(writer, types, scratch);
  if (op === Op.SPANREADONLY) {
    writer.local('ldloc', slots[0]);
    const result = memoryTypeName('ReadOnlySpan<' + span.element + '>');
    writer.op('call', context.external(type, 'op_Implicit', 'System.ReadOnlySpan`1<!0>', ['System.Span`1<!0>'], true));
    return;
  }
  writer.op('ldloca', slots[0]);
  for (let i = 1; i < slots.length && !(op === Op.SPANSET && i === 2); i++) writer.local('ldloc', slots[i]);
  if (op === Op.SPANLENGTH) writer.op('call', context.external(type, 'get_Length', 'int', [], false));
  else if (op === Op.SPANSLICE) writer.op('call', context.external(type, 'Slice', memoryTypeName((span.readonly?'ReadOnlySpan':'Span')+'<!0>'), Array(b).fill('int'), false));
  else {
    writer.op('call', context.external(type, 'get_Item', span.readonly?'!0& modreq(System.Runtime.InteropServices.InAttribute)':'!0&', ['int'], false));
    if (op === Op.SPANGET) writer.op('ldobj', context.resolveType(span.element));
    if (op === Op.SPANSET) {
      writer.local('ldloc', slots[2]).op('stobj', context.resolveType(span.element)).local('ldloc', slots[2]);
    }
  }
}

export function emitMemoryInstruction(writer, context, instruction) {
  const {op, a, b} = instruction;
  if (op < Op.NEWRECT || op > Op.SPANDEFAULT) return false;
  if(op===Op.SPANDEFAULT){
    const type=memoryTypeName((b?'ReadOnlySpan':'Span')+'<'+context.image.constants[a]+'>');
    const slot=instruction.scratch(type,1200);
    writer.op('ldloca',slot).op('initobj',context.resolveType(type)).local('ldloc',slot);
  }
  else if (op <= Op.RECTADDR) emitRectangle(writer, context, instruction);
  else if (op === Op.STACKALLOC) emitStackAllocation(writer, context, instruction);
  else emitSpan(writer, context, instruction);
  const marker = 'SharpForge.Memory:' + [op, op === Op.NEWRECT || op === Op.STACKALLOC || op === Op.SPANDEFAULT ? context.image.constants[a] : a, b].join('|');
  writer.op('ldstr', 0x70000000 | context.metadata.userString(marker)).op('pop');
  return true;
}
