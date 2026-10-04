import {
  Op
} from '@sharpforge/bytecode';
import {
  memoryTypeName
} from './source-memory-types.js';

const operations = new Map([
  ['arglist', Op.ARGLIST],
  ['mkrefany', Op.MKREFANY],
  ['refanyval', Op.REFANYVAL],
  ['refanytype', Op.REFANYTYPE]
]);
export const isSourceVarargsOpcode = name => operations.has(name);

/** Full canonical re-emission verifies the helper call attached to refanytype. */
export function decodeSourceVarargsSpan(span, context) {
  const instruction = span.find(item => operations.has(item.name));
  if (!instruction) return null;
  const type = ['mkrefany', 'refanyval'].includes(instruction.name) ?
    context.intern(memoryTypeName(context.metadata.typeName(instruction.operand))) : 0;
  return [operations.get(instruction.name), type, 0];
}
