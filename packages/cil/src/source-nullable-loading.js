import {Op, sourceNullableElement} from '@sharpforge/bytecode';

/** Recognized spans must also match canonical byte-for-byte re-emission before source execution. */
export function decodeSourceNullable(span, context) {
  const init = span.find(instruction => instruction.name === 'initobj');
  if (init) {
    const owner = context.metadata.typeName(init.operand);
    return sourceNullableElement(owner) ? [Op.NULLABLE, context.intern(owner), 0] : null;
  }
  const call = span.find(instruction => instruction.name === 'newobj' || instruction.name === 'call');
  if (!call) return null;
  const target = context.resolveCall(call.operand), owner = target.owner;
  if (!sourceNullableElement(owner)) return null;
  const mode = target.name === '.ctor' && call.name === 'newobj' ? 1 : target.name === 'get_HasValue' ? 2
    : target.name === 'get_Value' ? 3 : target.name === 'GetValueOrDefault' ? (target.sig.parameters.length ? 5 : 4)
      : target.name === 'ToString' ? 6 : null;
  return mode === null ? null : [Op.NULLABLE, context.intern(owner), mode];
}
