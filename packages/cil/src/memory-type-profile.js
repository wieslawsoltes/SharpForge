import {frameworkType} from '@sharpforge/framework';
import {genericTypeParts, normalizeCallType} from './generic-signatures.js';
import {verifyGenericType} from './generic-profile.js';

export const primitiveSizes = Object.freeze({
  'System.Boolean': 1, 'System.SByte': 1, 'System.Byte': 1, 'System.Char': 2,
  'System.Int16': 2, 'System.UInt16': 2, 'System.Int32': 4, 'System.UInt32': 4,
  'System.Int64': 8, 'System.UInt64': 8, 'System.Single': 4, 'System.Double': 8, 'System.Decimal': 16
});

const primitiveStorage = new Set(Object.keys(primitiveSizes).map(normalizeCallType).concat('nint', 'nuint'));

/** Closed aggregate TypeSpecs and bounded variables reach the runtime's concrete storage checks. */
export function verifyPrimitiveStorageOperand(inspector, method, instruction, issue, context) {
  try {
    const type = inspector.metadata.typeName(instruction.operand);
    verifyGenericType(inspector, type, context);
    const normalized = normalizeCallType(type), parts = genericTypeParts(normalized);
    if (/^!!?\d+$/.test(normalized)) return;
    const definition = inspector.types.find(candidate => candidate.token === instruction.operand || candidate.name === parts.definition);
    const isEnum = definition?.baseToken && inspector.metadata.typeName(definition.baseToken) === 'System.Enum' ||
      frameworkType(type)?.kind === 'enum';
    const isStruct = definition?.baseToken && inspector.metadata.typeName(definition.baseToken) === 'System.ValueType';
    if (isStruct || isEnum) return;
    if (!primitiveStorage.has(normalized)) {
      issue(method, instruction, 'IL_TYPE', instruction.name + ' requires supported value storage');
    }
  } catch (error) {
    issue(method, instruction, 'IL_TOKEN', error.message);
  }
}
