import { Binary, BinaryName, FORMAT_VERSION, Op, UnaryName } from '@sharpforge/bytecode';
import { ManagedFault, VirtualMachine } from '@sharpforge/runtime';
import { binaryRejection } from './binary-guards.js';

export const bytecodeLimits = Object.freeze({
  methods: 4, parameters: 4, locals: 16, codeWords: 768, constants: 32, statics: 4, fields: 4,
  maxInstructions: 1024, maxFrames: 4, maxStackBytes: 4096, maxBytes: 8192,
});
const imageKeys = new Set([
  'formatVersion', 'name', 'entryPoint', 'constants', 'types', 'statics', 'sequencePoints', 'sources', 'methods', 'outputKind',
]);
const methodKeys = new Set([
  'id', 'name', 'qualifiedName', 'owner', 'isStatic', 'returnType', 'parameters', 'handlers', 'locals', 'code',
]);
const localKeys = new Set(['name', 'type']);
const staticKeys = new Set(['name', 'type', 'value']);
const typeKeys = new Set(['id', 'name', 'fields']);
const scalarOpcodes = new Set([
  Op.CONST, Op.LDLOC, Op.STLOC, Op.DUP, Op.POP, Op.BINARY, Op.UNARY,
  Op.JUMP, Op.JFALSE, Op.JTRUE, Op.RET, Op.NOP,
]);
const boundedOpcodes = new Set([
  ...scalarOpcodes, Op.CALL, Op.LDSTATIC, Op.STSTATIC, Op.NEWOBJ, Op.LDFLD, Op.STFLD,
  Op.NEWARR, Op.LDELEM, Op.STELEM, Op.LENGTH,
]);
const controlledFaults = new Set([
  'InstructionLimitException', 'StackOverflowException', 'OutOfMemoryException',
  'DivideByZeroException', 'OverflowException', 'ArithmeticException',
]);
const int32 = value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
const boundedArray = (value, maximum) => Array.isArray(value) && value.length <= maximum;
const identifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
const inRange = (index, length) => Number.isInteger(index) && index >= 0 && index < length;

function record(value, keys) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.has(key));
}

function intLocal(value) {
  return record(value, localKeys) && value.type === 'int' && (value.name === undefined || identifier(value.name));
}

function localMetadata(value) {
  return record(value, localKeys) && ['int', 'int[]', 'FuzzBox'].includes(value.type) &&
    (value.name === undefined || identifier(value.name));
}

function methodMetadata(method, index) {
  return record(method, methodKeys) && method.id === index && method.isStatic === true && method.owner === null &&
    identifier(method.name) && identifier(method.qualifiedName) && method.returnType === 'int' &&
    boundedArray(method.handlers, 0) && boundedArray(method.parameters, bytecodeLimits.parameters) &&
    boundedArray(method.locals, bytecodeLimits.locals) && method.locals.length >= method.parameters.length &&
    method.parameters.every(intLocal) && method.locals.every(localMetadata) &&
    method.locals.slice(0, method.parameters.length).every(intLocal) && method.code instanceof Int32Array &&
    method.code.length > 0 && method.code.length % 3 === 0 && method.code.length <= bytecodeLimits.codeWords;
}

function closedMetadata(image) {
  if (!record(image, imageKeys) || image.formatVersion !== FORMAT_VERSION || !identifier(image.name) || image.entryPoint !== 0 ||
      ![undefined, 'exe'].includes(image.outputKind) || !boundedArray(image.methods, bytecodeLimits.methods) ||
      !image.methods.length || !boundedArray(image.constants, bytecodeLimits.constants) ||
      !boundedArray(image.types, 1) || !boundedArray(image.statics, bytecodeLimits.statics) ||
      !boundedArray(image.sequencePoints, 0) || !boundedArray(image.sources, 0)) return false;
  if (!image.constants.every(value => int32(value) || value === null || value === 'int')) return false;
  if (!image.statics.every(slot => record(slot, staticKeys) && slot.type === 'int' &&
      (slot.name === undefined || identifier(slot.name)) && (slot.value === null || int32(slot.value)))) return false;
  if (!image.types.every(type => record(type, typeKeys) && type.id === 0 && type.name === 'FuzzBox' &&
      boundedArray(type.fields, bytecodeLimits.fields) && type.fields.every(intLocal))) return false;
  return image.methods.every(methodMetadata) && image.methods[0].parameters.length === 0 &&
    image.methods.every(method => method.locals.every(local => local.type !== 'FuzzBox' || image.types.length === 1)) &&
    image.methods.reduce((total, method) => total + method.code.length, 0) <= bytecodeLimits.codeWords;
}

function instructionAllowed(image, method, offset, scalar) {
  const [opcode, operand, mode] = method.code.subarray(offset, offset + 3);
  if (!boundedOpcodes.has(opcode)) return false;
  if (opcode === Op.CONST) return inRange(operand, image.constants.length) && image.constants[operand] !== 'int';
  if (opcode === Op.LDLOC || opcode === Op.STLOC) return inRange(operand, method.locals.length);
  if (opcode === Op.LDSTATIC || opcode === Op.STSTATIC) return inRange(operand, image.statics.length);
  if (opcode === Op.CALL) return inRange(operand, image.methods.length) && mode === image.methods[operand].parameters.length;
  if (opcode === Op.NEWOBJ) return operand === 0 && image.types.length === 1;
  if (opcode === Op.LDFLD || opcode === Op.STFLD) return inRange(operand, image.types[0]?.fields.length ?? 0);
  if (opcode === Op.NEWARR) return inRange(operand, image.constants.length) && image.constants[operand] === 'int';
  if (opcode === Op.JUMP || opcode === Op.JTRUE || opcode === Op.JFALSE) return inRange(operand, method.code.length / 3);
  // Preserve the original scalar seeds' mode 0. Reference-bearing profiles use only bounded Int32 arithmetic.
  if (opcode === Op.BINARY || opcode === Op.UNARY) {
    const operation = opcode === Op.BINARY ? BinaryName[operand] : UnaryName[operand];
    if (!operation || opcode === Op.BINARY && operand === Binary['>>>']) return false;
    if (mode === 5) return opcode === Op.BINARY ? ['+', '-', '*'].includes(operation) : operation === '-';
    return mode === 1 || scalar && mode === 0;
  }
  return true;
}

/** Check all metadata and triples before VM construction; verification alone does not bound type expansion or host access. */
export function boundedBytecodeProfile(image) {
  if (!closedMetadata(image)) return false;
  const scalar = image.methods.length === 1 && !image.types.length && !image.statics.length &&
    image.methods[0].locals.every(intLocal) && image.methods[0].code.every((value, index) => index % 3 !== 0 || scalarOpcodes.has(value));
  for (const method of image.methods) {
    for (let offset = 0; offset < method.code.length; offset += 3) {
      if (!instructionAllowed(image, method, offset, scalar)) return false;
    }
  }
  return true;
}

export function excludedBytecodeProfile() {
  return { status: 'unsupported', code: 'BYTECODE_EXECUTION_PROFILE', detail: 'Verified; bounded managed profile excluded this image' };
}

/** Keep the existing exact fault allowlist; wrapped host errors and all unclassified managed faults remain findings. */
export function bytecodeExecutionOutcome(result) {
  if (result.fault) {
    if (!(result.fault instanceof ManagedFault) || !controlledFaults.has(result.fault.name)) throw result.fault;
    return binaryRejection('BYTECODE_RUNTIME_LIMIT_OR_ARITHMETIC', result.fault.name);
  }
  if (result.state !== 'terminated' || result.output !== '' || !Number.isInteger(result.stats.instructions) ||
      result.stats.instructions < 0 || result.stats.instructions > bytecodeLimits.maxInstructions ||
      !Number.isSafeInteger(result.stats.heap.peakBytes) || result.stats.heap.peakBytes < 0 ||
      result.stats.heap.peakBytes > bytecodeLimits.maxBytes || !Number.isSafeInteger(result.stats.heap.allocations) ||
      result.stats.heap.allocations < 0 || !int32(result.exitCode) || result.stats.frames !== 0) {
    throw new Error('Verified managed bytecode violated the bounded execution contract');
  }
  return { status: 'accepted', code: 'BYTECODE_VERIFIED_BOUNDED_EXECUTED' };
}

/** Execute a closed source profile with fixed limits; no caller supplies VM options, host bridges or grants. */
export function executeBoundedBytecode(image, limits) {
  if (!boundedBytecodeProfile(image)) return excludedBytecodeProfile();
  if (limits.signal?.aborted) return binaryRejection('FUZZ_CANCELLED');
  let vm, outcome, proof;
  try {
    vm = new VirtualMachine(image, {
      maxInstructions: bytecodeLimits.maxInstructions, maxFrames: bytecodeLimits.maxFrames,
      maxStackBytes: bytecodeLimits.maxStackBytes, maxBytes: bytecodeLimits.maxBytes,
      maxOutputCharacters: 0, maxUICommands: 0, framePoolBytes: 0, framePooling: false,
      virtualTime: true, environment: {},
    });
    const result = vm.run();
    outcome = bytecodeExecutionOutcome(result);
    const external = vm.platform.runtimeInfo();
    if (external.externalRevision !== 0 || external.pendingExternal !== 0 || external.network.enabled !== false ||
        external.compute !== null || vm.scheduler.enabled || vm.platform.windows.size) {
      throw new Error('Bounded bytecode activated a host capability or scheduler');
    }
    proof = {
      profile: 'bounded-managed-int-v1', exitCode: result.exitCode, instructions: result.stats.instructions,
      heapPeakBytes: result.stats.heap.peakBytes, heapAllocations: result.stats.heap.allocations,
      maxInstructions: bytecodeLimits.maxInstructions, maxFrames: bytecodeLimits.maxFrames,
      maxStackBytes: bytecodeLimits.maxStackBytes, maxBytes: bytecodeLimits.maxBytes,
      externalOperations: 0,
    };
  } catch (error) {
    if (!(error instanceof ManagedFault) || !controlledFaults.has(error.name)) throw error;
    outcome = binaryRejection('BYTECODE_RUNTIME_LIMIT_OR_ARITHMETIC', error.name);
  } finally {
    vm?.stop();
  }
  if (vm && (vm.frames.length || vm.stack.length || vm.state !== 'terminated')) {
    throw new Error('Bounded bytecode disposal retained execution state');
  }
  if (outcome.status === 'accepted') outcome.detail = JSON.stringify({ ...proof, disposed: true });
  return outcome;
}
