/** Render the public language symbol shape without requiring compiler-internal symbol objects. */
export function symbolDetail(symbol) {
  if (symbol.kind === 'method') {
    const parameters = (symbol.parameters ?? []).map(parameter => parameter.type + ' ' + parameter.name).join(', ');
    return `${symbol.isStatic ? 'static ' : ''}${symbol.type} ${symbol.owner ? symbol.owner + '.' : ''}${symbol.name}(${parameters})`;
  }
  return symbol.kind === 'class' ? 'class ' + (symbol.fullName ?? symbol.name) : `${symbol.type} ${symbol.name}`;
}

export const intrinsicDocs = {
  Console: 'Writes program output to the managed console.',
  Math: 'Numeric functions in the supported runtime profile.',
  GC: 'Controls the precise, non-generational managed collector.',
  Array: 'Array helpers.',
  Convert: 'Primitive conversion helpers.',
  Debug: 'Runtime assertions.'
};
