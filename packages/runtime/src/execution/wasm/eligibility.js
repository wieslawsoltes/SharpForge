import {numericTypeName} from '@sharpforge/bytecode';
import {normalizeCallType, resolveExecutionMethod, verifiedStackBound} from '@sharpforge/cil';
import {cilHandlers} from '../handlers/index.js';
import {getDecodePlan} from '../decode-plan.js';
import {buildWasmIR} from './ir.js';
import {wasmMetadataFits} from './metadata-budget.js';

const primitives = new Set(['bool', 'char', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint',
  'long', 'ulong', 'float', 'double', 'string', 'object']);
const forbidden = /^(ldloca|ldarga|ldflda|ldsflda|ldelema|ldind|stind|ldobj|stobj|cpobj|initobj|localloc|cpblk|initblk)(\.|$)/;
const unsupported = new Set(['calli', 'jmp', 'arglist', 'mkrefany', 'refanytype', 'refanyval', 'ldftn', 'ldvirtftn',
  'unbox', 'constrained.', 'tail.', 'readonly.', 'unaligned.', 'endfinally', 'endfilter', 'rethrow', 'leave', 'leave.s']);
const optionNames = new Set(['maxMethodInstructions', 'maxAnalysisSlots']);

function limits(options) {
  for (const name of Object.keys(options)) {
    if (!optionNames.has(name)) throw new TypeError('Unknown Wasm analysis option: ' + name);
  }
  const instructions = options.maxMethodInstructions ?? 4096;
  const slots = options.maxAnalysisSlots ?? 262144;
  if (!Number.isSafeInteger(instructions) || instructions < 1 || instructions > 65536 ||
      !Number.isSafeInteger(slots) || slots < 1 || slots > 16777216) throw new RangeError('Invalid Wasm analysis limit');
  return {instructions, slots};
}

function supportedType(vm, type, allowVoid = false) {
  if (typeof type !== 'string' || /[&*]|\bpinned\b|!\d|\bmod(?:req|opt)\(/.test(type)) return false;
  const name = numericTypeName(normalizeCallType(type));
  if (primitives.has(name) || allowVoid && name === 'void') return true;
  if (['void', 'decimal', 'nint', 'nuint'].includes(name)) return false;
  const table = vm.typeSystem.table(type);
  return !table.containsGenericParameters && !table.flags.external && table.flags.valueType === false;
}

function methodReasons(vm, method, reject) {
  if (method.handlers.length) reject('WASM_EH', 'Methods with exception regions remain interpreted.');
  for (const type of [...method.locals, ...method.signature.parameters]) {
    if (!supportedType(vm, type)) reject('WASM_STORAGE', `Storage type '${type}' is outside the initial tier profile.`);
  }
  if (!supportedType(vm, method.signature.returnType, true)) reject('WASM_STORAGE', 'Unsupported return storage.');
  if (!method.signature.isStatic && !supportedType(vm, method.owner)) {
    reject('WASM_RECEIVER', 'Value-type receivers require the interpreter managed-pointer path.');
  }
  for (const instruction of method.instructions) {
    const name = instruction.name;
    if (!cilHandlers.has(name) || forbidden.test(name) || unsupported.has(name)) {
      reject('WASM_OPCODE', `Instruction '${name}' requires interpreter execution.`, instruction);
    }
    if (['call', 'callvirt', 'newobj'].includes(name)) {
      const descriptor = resolveExecutionMethod(vm.inspector, instruction.operand, method);
      const signature = descriptor.signature;
      if (!signature || name === 'newobj' && !supportedType(vm, descriptor.ownerInstance ?? descriptor.owner) ||
          signature.parameters.some(type => !supportedType(vm, type)) || !supportedType(vm, signature.returnType, true)) {
        reject('WASM_CALL', 'Call signatures with byrefs or unsupported value types remain interpreted.', instruction);
      }
    }
  }
}

/** Bounded, cold eligibility analysis. It neither compiles Wasm nor changes execution frames. */
export function wasmEligibility(vm, method, options = {}) {
  const bound = limits(options);
  const reasons = [];
  const reject = (code, message, instruction = null) => {
    reasons.push(Object.freeze({code, message, offset: instruction?.offset ?? null}));
  };
  let ir = null;
  try {
    if (!Array.isArray(method?.instructions) || !method.instructions.length) {
      reject('WASM_NO_BODY', 'The method has no decoded CIL body.');
    } else if (method.instructions.length > bound.instructions) {
      reject('WASM_SIZE', `The method exceeds the ${bound.instructions} instruction analysis limit.`);
    } else if (!wasmMetadataFits(method, bound.slots * 4)) {
      reject('WASM_ANALYSIS_LIMIT', 'Control-flow metadata exceeds the analysis work limit.');
    } else {
      const proof = verifiedStackBound(vm.inspector, vm.report, method);
      if (!proof) reject('WASM_UNVERIFIED', 'An exact canonical, successfully verified CIL body is required.');
      else if (method.instructions.length * Math.max(1, proof.peak) > bound.slots) {
        reject('WASM_ANALYSIS_LIMIT', 'The verified instruction/stack product exceeds the analysis slot limit.');
      } else {
        methodReasons(vm, method, reject);
        if (!reasons.length) {
          ir = buildWasmIR(vm, method, getDecodePlan(vm, method), bound.slots * 4);
          if (!ir.nativeInstructions) reject('WASM_NO_NATIVE_WORK', 'No supported native numeric operations were found.');
        }
      }
    }
  } catch (error) {
    reject(error.code === 'WASM_ANALYSIS_LIMIT' ? error.code : 'WASM_METADATA', error.message ?? String(error));
  }
  return Object.freeze({eligible: reasons.length === 0, reasons: Object.freeze(reasons), ir: reasons.length ? null : ir});
}

/** Return an immutable typed stack IR, or a TypeError carrying the explicit eligibility reasons. */
export function lowerWasmIR(vm, method, options = {}) {
  const report = wasmEligibility(vm, method, options);
  if (report.eligible) return report.ir;
  const error = new TypeError('Method is not eligible for the Wasm IR');
  error.reasons = report.reasons;
  throw error;
}
