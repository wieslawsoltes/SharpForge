const expression = (kind, legacyType, fields) => ({kind, legacyType, isExpression: true, ...fields});
export const pointerConversion = (operand, elementType) => expression('PointerConversion', elementType + '*', {operand, elementType});
export const pointerBinary = (operator, left, right, type) => expression('PointerBinary', type, {operator, left, right});
export const memorySize = type => expression('MemorySize', 'int', {elementType: type});
export const memoryPin = (address, elementType, local) => expression('MemoryPin', elementType + '*', {address, elementType, local});
export const memoryUnpin = local => expression('MemoryUnpin', 'void', {local});
export const rawStackAllocation = (elementType, length, initializer) =>
  expression('RawStackAllocation', elementType + '*', {elementType, length, initializer});
