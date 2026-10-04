/** C# 11 UTF-8 literals: a span over static PE data, with the actual target's array constructor as its fallback. */

function arrayFallback(emitter, literal, constructors) {
  const il = emitter.il;
  il.emit('ldc.i4', literal.bytes.length).emit('newarr', emitter.tokens.type(emitter.core.byte));
  for (let index = 0; index < literal.bytes.length; index++) {
    const value = literal.bytes[index];
    // New arrays are zero initialized, including embedded zeros and the required terminal NUL.
    if (value) il.emit('dup').emit('ldc.i4', index).emit('ldc.i4', value).emit('stelem.i1');
  }
  il.recordTop?.(constructors.arrayType);
  il.emit('ldc.i4', 0).emit('ldc.i4', literal.length);
  il.emit('newobj', emitter.tokens.method(constructors.array), { pops: 3, pushes: 1 });
}

/** Emit one preplanned UTF-8 literal and record its value type for stackalloc/async operand spilling. */
export function emitUtf8Literal(emitter, node) {
  const plan = emitter.program.utf8Literals;
  const literal = plan.literal(node.text);
  const constructors = plan.constructors;
  if (constructors.pointer) {
    emitter.il.emit('ldsflda', literal.field.token).emit('ldc.i4', literal.length);
    emitter.il.emit('newobj', emitter.tokens.method(constructors.pointer), { pops: 2, pushes: 1 });
  } else arrayFallback(emitter, literal, constructors);
  emitter.il.recordTop?.(node.type);
}
