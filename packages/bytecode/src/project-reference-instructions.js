import {Op} from './opcodes.js';

function callEffect(references, opcode, operand, argumentCount) {
  const method = references?.methods?.[operand];
  if (!method || !Array.isArray(method.parameters)) return {need: 0, delta: 0, error: 'Invalid external method'};
  const constructor = opcode === Op.EXTNEWOBJ;
  if (constructor && (method.name !== '.ctor' || method.isStatic)) {
    return {need: 0, delta: 0, error: 'Invalid external constructor'};
  }
  const expected = method.parameters.length + (constructor || method.isStatic ? 0 : 1);
  if (argumentCount !== expected) return {need: 0, delta: 0, error: 'Invalid external argument count'};
  return {need: expected, delta: 1 - expected};
}

function fieldEffect(references, opcode, operand, reserved) {
  const field = references?.fields?.[operand];
  if (!field || reserved !== 0) return {need: 0, delta: 0, error: 'Invalid external field'};
  const isStatic = opcode === Op.EXTLDSTATIC || opcode === Op.EXTSTSTATIC;
  if (field.isStatic !== isStatic) return {need: 0, delta: 0, error: 'Invalid external field access mode'};
  if (opcode === Op.EXTLDFLD) return {need: 1, delta: 0};
  if (opcode === Op.EXTSTFLD) return {need: 2, delta: -1};
  if (opcode === Op.EXTLDSTATIC) return {need: 0, delta: 1};
  return {need: 1, delta: 0};
}

/** Optional verifier extension. Existing instruction paths never call or allocate through this helper. */
export function projectInstructionEffect(image, opcode, operand, secondOperand) {
  if (opcode < Op.EXTCALL || opcode > Op.EXTSTSTATIC) return null;
  if (operand < 0) return {need: 0, delta: 0, error: 'Invalid external reference operand'};
  if (opcode === Op.EXTCALL || opcode === Op.EXTNEWOBJ) {
    return callEffect(image.externalReferences, opcode, operand, secondOperand);
  }
  return fieldEffect(image.externalReferences, opcode, operand, secondOperand);
}
