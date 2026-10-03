import {numericTypeName} from '@sharpforge/bytecode';
import {callStorageType, resolveExecutionMethod} from '@sharpforge/cil';
import {cilHandlers} from '../handlers/index.js';
import {verifiedMethod} from '../token-cache.js';
import {lowerWasmIR} from './ir.js';

const primitives = new Set(['void', 'bool', 'char', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint',
  'long', 'ulong', 'float', 'double', 'string', 'object']);
const forbidden = /^(ldloca|ldarga|ldflda|ldsflda|ldelema|ldind|stind|ldobj|stobj|cpobj|initobj|localloc|cpblk|initblk)(\.|$)/;
const unsupported = new Set(['calli', 'jmp', 'arglist', 'mkrefany', 'refanytype', 'refanyval', 'ldftn', 'ldvirtftn',
  'unbox', 'constrained.', 'tail.', 'readonly.', 'unaligned.', 'endfinally', 'endfilter', 'rethrow', 'leave', 'leave.s']);

function supportedType(vm, type) {
  if (typeof type !== 'string' || /[&*]|\bpinned\b|!\d/.test(type)) return false;
  const name = numericTypeName(callStorageType(type));
  if (primitives.has(name) || name.endsWith(']')) return true;
  if (['decimal', 'nint', 'nuint'].includes(name)) return false;
  return vm.typeSystem.table(type).flags.valueType === false;
}

function methodReasons(vm, method, limit) {
  const reasons = [];
  const reject = (code, message, instruction = null) => reasons.push(Object.freeze({code, message, offset: instruction?.offset ?? null}));
  if (!vm.report?.success || !verifiedMethod(vm, method.token) ||
      vm.inspector.getMethod(method.token).instructions !== method.instructions) {
    reject('WASM_UNVERIFIED', 'Tiering requires a canonical, successfully verified CIL body.');
  }
  if (!method.instructions?.length) reject('WASM_NO_BODY', 'The method has no CIL body.');
  if (method.instructions?.length > limit) reject('WASM_SIZE', `The method exceeds the ${limit} instruction compilation limit.`);
  if (method.handlers?.length) reject('WASM_EH', 'Methods with exception regions remain interpreted.');
  for (const type of [...method.locals, ...method.signature.parameters, method.signature.returnType]) {
    if (!supportedType(vm, type)) reject('WASM_STORAGE', `Storage type '${type}' is outside the tier-1 profile.`);
  }
  if (!method.signature.isStatic && !supportedType(vm, method.owner)) {
    reject('WASM_RECEIVER', 'Value-type receivers require the interpreter managed-pointer path.');
  }
  for (const instruction of method.instructions ?? []) {
    const name = instruction.name;
    if (!cilHandlers.has(name) || forbidden.test(name) || unsupported.has(name)) {
      reject('WASM_OPCODE', `Instruction '${name}' requires interpreter execution.`, instruction);
    }
    if (['call', 'callvirt', 'newobj'].includes(name)) {
      const descriptor = resolveExecutionMethod(vm.inspector, instruction.operand, method);
      const signature = descriptor.signature ?? descriptor.raw?.signature;
      if (!signature || name === 'newobj' && !supportedType(vm, descriptor.owner) ||
          [...signature.parameters, signature.returnType].some(type => !supportedType(vm, type))) {
        reject('WASM_CALL', 'Call signatures with byrefs or unsupported value types remain interpreted.', instruction);
      }
    }
  }
  return reasons;
}

/** Report explicit fallback reasons; invalid or unsupported metadata never starts native compilation. */
export function wasmEligibility(vm, method, options = {}) {
  const limit = options.maxMethodInstructions ?? 4096;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65536) throw new RangeError('Invalid Wasm method instruction limit');
  let reasons;
  let ir = null;
  try {
    reasons = methodReasons(vm, method, limit);
    if (!reasons.length) {
      const offsets = new Map(method.instructions.map((instruction, pc) => [instruction.offset, pc]));
      ir = lowerWasmIR(vm, method, offsets);
      if (!ir.nativeInstructions) reasons.push(Object.freeze({code: 'WASM_NO_NATIVE_WORK',
        message: 'The method has no supported native numeric instructions.', offset: null}));
    }
  } catch (error) {
    reasons = [Object.freeze({code: 'WASM_METADATA', message: error.message ?? String(error), offset: null})];
  }
  return Object.freeze({eligible: reasons.length === 0, reasons: Object.freeze(reasons), ir: reasons.length ? null : ir});
}
