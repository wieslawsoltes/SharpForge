/** Widening at a typed call/store boundary must retain the UInt32 source interpretation. */
export function needsNumericAdaptation(from, to) {
  return to === 'double' && ['int', 'uint', 'float'].includes(from) ||
    to === 'float' && ['int', 'uint', 'double'].includes(from);
}

export function emitNumericAdaptation(writer, from, to) {
  if (!needsNumericAdaptation(from, to)) return false;
  if (from === 'uint') writer.op('conv.r.un');
  writer.op(to === 'float' ? 'conv.r4' : 'conv.r8');
  return true;
}
