import {Op, arrayType, spanType, memoryTypeName} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

export function analyzeMemoryInstruction(stack, instruction, constants) {
  const {op, a, b} = instruction;
  if (op < Op.NEWRECT || op > Op.SPANDEFAULT) return false;
  const pop = () => {
    if (!stack.length) throw new CilError('Memory instruction stack underflow');
    return stack.pop();
  };
  if(op===Op.SPANDEFAULT){stack.push(memoryTypeName((b?'ReadOnlySpan':'Span')+'<'+constants[a]+'>'));}
  else if (op === Op.NEWRECT) {
    for (let i = 0; i < b; i++) pop();
    stack.push(constants[a] + '[' + ','.repeat(b - 1) + ']');
  } else if (op === Op.STACKALLOC) {
    pop(); stack.push(memoryTypeName('Span<' + constants[a] + '>'));
  } else if ([Op.LDRECT, Op.STRECT, Op.RECTADDR].includes(op)) {
    if (op === Op.STRECT) pop();
    for (let i = 0; i < a; i++) pop();
    const array = arrayType(pop());
    if (array?.rank !== a) throw new CilError('Rectangular array rank mismatch');
    stack.push(array.element + (op === Op.RECTADDR ? '&' : ''));
  } else if ([Op.SPANGET, Op.SPANSET, Op.SPANADDR].includes(op)) {
    if (op === Op.SPANSET) pop();
    pop();
    const span = spanType(pop());
    if (!span || span.readonly && op === Op.SPANSET) throw new CilError('Invalid Span element operation');
    stack.push(span.element + (op === Op.SPANADDR ? '&' : ''));
  } else if (op === Op.SPANSLICE) {
    for (let i = 0; i < b; i++) pop();
    const type = pop();
    if (!spanType(type)) throw new CilError('Slice requires Span');
    stack.push(type);
  } else if (op === Op.SPANLENGTH) { pop(); stack.push('int'); }
  else {
    const span = spanType(pop());
    if (!span || span.readonly) throw new CilError('Readonly conversion requires a writable Span');
    stack.push(memoryTypeName('ReadOnlySpan<' + span.element + '>'));
  }
  return true;
}
