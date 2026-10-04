import {frameworkType} from '@sharpforge/framework';

export const primitiveSizes = Object.freeze({
  'System.Boolean': 1, 'System.SByte': 1, 'System.Byte': 1, 'System.Char': 2,
  'System.Int16': 2, 'System.UInt16': 2, 'System.Int32': 4, 'System.UInt32': 4,
  'System.Int64': 8, 'System.UInt64': 8, 'System.Single': 4, 'System.Double': 8, 'System.Decimal': 16
});

/** Concrete TypeDef values reach runtime layout admission; opaque value storage stays unsupported. */
export function verifyPrimitiveStorageOperand(inspector, method, instruction, issue) {
  try {
    const type = inspector.metadata.typeName(instruction.operand);
    const definition = inspector.types.find(type => type.token === instruction.operand);
    const isEnum = definition?.baseToken && inspector.metadata.typeName(definition.baseToken) === 'System.Enum' ||
      frameworkType(type)?.kind === 'enum';
    const isStruct = definition?.baseToken && inspector.metadata.typeName(definition.baseToken) === 'System.ValueType';
    if (isStruct && (instruction.name === 'cpobj' || instruction.name === 'unbox')) return;
    if (!primitiveSizes[type] && type !== 'System.IntPtr' && type !== 'System.UIntPtr' &&
        !(instruction.name === 'unbox' && isEnum)) {
      issue(method, instruction, 'IL_TYPE', instruction.name + ' is implemented only for primitive types' +
        (instruction.name === 'unbox' ? ' and enums' : ''));
    }
  } catch (error) {
    issue(method, instruction, 'IL_TOKEN', error.message);
  }
}
