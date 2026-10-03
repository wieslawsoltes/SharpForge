/** Memory type shapes shared by source lowering and CLI signature construction. */
export function arrayType(type) {
  const match = /^(.*)\[([,]*)\]$/.exec(type ?? '');
  return match ? {element: match[1], rank: match[2].length + 1} : null;
}

export function spanType(type) {
  const match = /^(?:System\.)?(ReadOnlySpan|Span)(?:`1)?\s*<(.+)>$/.exec(type ?? '');
  return match ? {element: match[2].trim(), readonly: match[1] === 'ReadOnlySpan'} : null;
}

export function memoryTypeName(type) {
  const span = spanType(type);
  if (span) return 'System.' + (span.readonly ? 'ReadOnlySpan' : 'Span') + '`1<' + memoryTypeName(span.element) + '>';
  const array = arrayType(type);
  return array ? memoryTypeName(array.element) + '[' + ','.repeat(array.rank - 1) + ']' : type;
}

export {Op as memoryOpcodes} from './opcodes.js';
