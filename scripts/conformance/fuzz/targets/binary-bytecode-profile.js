import { Op } from '@sharpforge/bytecode';
import { ManagedFault, VirtualMachine } from '@sharpforge/runtime';
import { binaryRejection } from './binary-guards.js';

const pureOpcodes = new Set([
  Op.CONST, Op.LDLOC, Op.STLOC, Op.DUP, Op.POP, Op.BINARY, Op.UNARY,
  Op.JUMP, Op.JFALSE, Op.JTRUE, Op.RET, Op.NOP,
]);
const controlledFaults = new Set([
  'InstructionLimitException', 'StackOverflowException', 'OutOfMemoryException',
  'DivideByZeroException', 'OverflowException', 'ArithmeticException',
]);

/** Admission excludes host calls, references, allocation opcodes, handlers and all other runtime profiles. */
export function pureBytecodeProfile(image) {
  if (image.outputKind === 'library' || image.entryPoint !== 0 || image.methods.length !== 1 ||
      image.types.length || image.statics.length || image.sequencePoints.length) return false;
  if (!image.constants.every(value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff)) {
    return false;
  }
  const method = image.methods[0];
  if (method.id !== 0 || !method.isStatic || method.returnType !== 'int' || method.handlers.length ||
      !Array.isArray(method.parameters) || method.parameters.length || method.locals.length > 16 ||
      method.code.length > 768) return false;
  if (!method.locals.every(local => local && local.type === 'int')) return false;
  for (let offset = 0; offset < method.code.length; offset += 3) {
    if (!pureOpcodes.has(method.code[offset])) return false;
  }
  return true;
}

/** Execute one verified scalar program with fixed VM limits and preserve wrapped host faults as findings. */
export function executePureBytecode(image, limits) {
  let vm;
  try {
    vm = new VirtualMachine(image, {
      maxInstructions: 1024,
      maxFrames: 1,
      maxStackBytes: 4096,
      maxBytes: 8192,
      maxOutputCharacters: 0,
      maxUICommands: 0,
      virtualTime: true,
      environment: {},
    });
    if (limits.signal?.aborted) return binaryRejection('FUZZ_CANCELLED');
    const result = vm.run();
    if (result.fault) {
      if (!(result.fault instanceof ManagedFault) || !controlledFaults.has(result.fault.name)) {
        throw result.fault;
      }
      return binaryRejection('BYTECODE_RUNTIME_LIMIT_OR_ARITHMETIC', result.fault.name);
    }
    if (result.state !== 'terminated' || result.output !== '' || result.stats.instructions > 1025) {
      throw new Error('Verified scalar bytecode violated the bounded execution contract');
    }
    return { status: 'accepted', code: 'BYTECODE_VERIFIED_SCALAR_EXECUTED' };
  } catch (error) {
    if (error instanceof ManagedFault && controlledFaults.has(error.name)) {
      return binaryRejection('BYTECODE_RUNTIME_LIMIT_OR_ARITHMETIC', error.name);
    }
    throw error;
  } finally {
    vm?.stop();
  }
}
