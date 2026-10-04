import { decodeInstructions } from './opcodes.js';
import { CilError } from './binary.js';

export const ilLabel = offset => 'IL_' + offset.toString(16).padStart(4, '0');

function operandText(instruction, inspector) {
  if (instruction.operandKind === 'token') return inspector.describeToken(instruction.operand);
  if (instruction.operandKind === 'switch') return '(' + instruction.operand.map(ilLabel).join(', ') + ')';
  if (instruction.operandKind.startsWith('br')) return ilLabel(instruction.operand);
  return instruction.operand === undefined ? '' : String(instruction.operand);
}

function decodeMethod(inspector, token, describeOperands = false) {
  const definition = inspector.methods.get(token);
  if (!definition) throw new CilError('MethodDef not found');
  const metadata = inspector.metadata;
  const signature = inspector.signature(token);
  const parameters = [];
  for (const parameterToken of metadata.list(token, 'ParamList')) {
    const row = metadata.row(parameterToken);
    parameters.push({ sequence: row[1], name: metadata.string(row[2]), flags: row[0] });
  }
  const info = inspector.debug?.methods?.find(method => method.token === token);
  const points = new Map((inspector.debug?.sequencePoints ?? []).filter(point => point.methodToken === token)
    .map(point => [point.ilOffset, point]));
  const method = { ...definition, signature, parameters, id: info?.id ?? null,
    locals: [], instructions: [], handlers: [], codeSize: 0, maxStack: 0 };
  if (!definition.hasBody) return method;
  const body = inspector.pe.methodBody(token);
  const locals = body.localSignature ? inspector.signature(body.localSignature).types : [];
  const instructions = decodeInstructions(body.code, inspector.options).map(instruction => {
    const label = ilLabel(instruction.offset);
    const point = points.get(instruction.offset) ?? null;
    return describeOperands ? { ...instruction, label, operandText: operandText(instruction, inspector), point }
      : { ...instruction, label, point };
  });
  return { ...method, locals, instructions, handlers: body.handlers, maxStack: body.maxStack,
    codeSize: body.code.length, localSignature: body.localSignature, initLocals: body.initLocals };
}

/** Internal typed-consumer view. Suppresses new display decoding; existing public cache facts can be reused. */
export function decodedInspectorMethod(inspector, token) {
  if (inspector.cache.has(token)) return inspector.cache.get(token);
  const cache = inspector.decodedMethods ??= new Map();
  if (!cache.has(token)) cache.set(token, decodeMethod(inspector, token));
  return cache.get(token);
}

/** Public inspection keeps its original cache identity and complete display shape. IL is decoded only once. */
export function describedInspectorMethod(inspector, token) {
  if (inspector.cache.has(token)) return inspector.cache.get(token);
  const decoded = inspector.decodedMethods?.get(token);
  const method = decoded ? { ...decoded, instructions: decoded.instructions.map(instruction => {
    const { point, ...details } = instruction;
    return { ...details, operandText: operandText(instruction, inspector), point };
  }) } : decodeMethod(inspector, token, true);
  inspector.cache.set(token, method);
  inspector.decodedMethods?.delete(token);
  return method;
}
