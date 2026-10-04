/** Typed storage operations shared by source lowering and the image emitter. */
const expression = (kind, legacyType, fields = {}) => ({kind, legacyType, isExpression: true, ...fields});

export const managedDereference = (address, type = address.legacyType.slice(0, -1)) =>
  expression('ManagedDereference', type, {address});

/** An address retains its storage owner, including a parent byref into a value field. */
export function managedAddress(target, {readonly = false} = {}) {
  if (target.kind === 'ManagedDereference' && !readonly) return target.address;
  if (target.kind === 'Sequence') {
    return {...target, legacyType: target.legacyType + '&', value: managedAddress(target.value, {readonly})};
  }
  return expression('ManagedAddress', target.legacyType + '&', {target, readonly});
}

export const rectangularElement = (array, indices, type) => expression('RectangularElement', type, {array, indices});
export const rectangularArray = (elementType, lengths, initializer = null) =>
  expression('RectangularArray', elementType + '[' + ','.repeat(lengths.length - 1) + ']', {
    elementType, lengths, initializer
  });
export const spanElement = (span, index, type, readonly = false) =>
  expression('SpanElement', type, {span, index, readonly});
export const stackAllocation = (elementType, length, initializer = null) =>
  expression('StackAllocation', 'System.Span<' + elementType + '>', {elementType, length, initializer});
export const spanDefault = type => expression('SpanDefault', type);
export const spanLength = span => expression('SpanLength', 'int', {span});
export const spanSlice = (span, args) => expression('SpanSlice', span.legacyType, {span, args});
export const spanReadOnly = span => expression('SpanReadOnly', span.legacyType.replace('System.Span<', 'System.ReadOnlySpan<'), {span});
