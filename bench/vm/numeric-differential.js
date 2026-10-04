import {CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {arithmeticAssembly} from './qualification-assembly.js';
import {abortIfNeeded} from './operations.js';

export const int32Operations = Object.freeze(['add', 'sub', 'mul', 'and', 'or', 'xor', 'shl', 'shr', 'shr.un',
  'div', 'rem', 'div.un', 'rem.un', 'add.ovf', 'sub.ovf', 'mul.ovf', 'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un',
  'neg', 'not', 'ceq', 'clt', 'clt.un', 'cgt', 'cgt.un']);
export const int64Operations = Object.freeze(['add', 'sub', 'mul', 'div', 'rem', 'div.un', 'rem.un',
  'add.ovf', 'sub.ovf', 'mul.ovf', 'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un', 'neg', 'ceq', 'clt', 'clt.un', 'cgt', 'cgt.un']);
const safeMaximum = 9007199254740991n;
const bounds32 = [-2147483648, -2147483647, -65536, -1, 0, 1, 2, 31, 32, 65535, 2147483646, 2147483647];
const bounds64 = [-(1n << 63n), -(1n << 63n) + 1n, -safeMaximum - 1n, -safeMaximum, -1n, 0n, 1n,
  63n, 64n, safeMaximum, safeMaximum + 1n, (1n << 63n) - 1n];

function randomWords(seed) {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
}

function signed64(next) {
  return BigInt.asIntN(64, BigInt(next()) << 32n | BigInt(next()));
}

function operands(width, index, next, target) {
  const boundaries = width === 32 ? bounds32 : bounds64;
  if (index < boundaries.length ** 2) {
    target[0] = boundaries[Math.floor(index / boundaries.length)];
    target[1] = boundaries[index % boundaries.length];
  } else if (width === 32) {
    target[0] = next() | 0;
    target[1] = next() | 0;
  } else {
    const mode = index % 6;
    if (mode === 0) {
      target[0] = signed64(next);
      target[1] = signed64(next);
    } else if (mode === 1 || mode === 4) {
      target[0] = signed64(next) % safeMaximum;
      target[1] = mode === 1 ? signed64(next) % safeMaximum : BigInt(next() % 17);
    } else if (mode === 2 || mode === 3) {
      target[0] = BigInt(mode === 2 ? next() | 0 : (next() & 65535) - 32768);
      target[1] = BigInt(mode === 2 ? next() | 0 : (next() & 65535) - 32768);
    } else {
      target[0] = safeMaximum - BigInt(next() & 1023);
      target[1] = BigInt((next() % 63) + 1);
    }
  }
}

function outcome(vm, values, instructionIndex, result) {
  const frame = vm.top;
  frame.stack.length = 0;
  frame.stack.push(...values);
  frame.pc = instructionIndex;
  result.fault = result.message = result.value = null;
  try {
    vm.step();
    result.value = vm.pop();
  } catch (error) {
    result.fault = error.name;
    result.message = error.message;
  }
  result.depth = frame.stack.length;
}

function matching(left, right) {
  return left.fault === right.fault && left.message === right.message && left.depth === right.depth && Object.is(left.value, right.value);
}

function printable(value) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() + 'n' : item);
}

async function compareOperation(context, operation, cases, ordinal) {
  const {width, options, signal, report} = context;
  const unary = operation === 'neg' || operation === 'not';
  const initial = width === 32 ? 0 : 0n;
  const bytes = arithmeticAssembly(operation, width);
  const shared = {nativeIntBits: options.nativeBits, arguments: unary ? [initial] : [initial, initial],
    typedNumericStack: false, wasmTiering: false, scalarSlotLoads: true};
  const generic = new CilVirtualMachine(bytes, {...shared, specializeNumericHandlers: false, smallLongs: false});
  let optimized;
  const row = {operation, requested: cases, completed: 0, faults: 0, safeInt64Operands: 0, wideInt64Operands: 0};
  report.operations.push(row);
  try {
    optimized = new CilVirtualMachine(bytes, {...shared, specializeNumericHandlers: width === 32, smallLongs: width === 64});
    prepareExecution(generic);
    const prepared = prepareExecution(optimized);
    const selectedId = operation.replaceAll('.', '_') + (width === 32 ? '_i4' : '_small_i8');
    if (!prepared.numericHandlerCounts?.[selectedId]) throw new Error('Expected specialized handler was not selected: ' + selectedId);
    row.handler = selectedId;
    const next = randomWords((options.seed + Math.imul(ordinal + 1, 0x9e3779b9)) >>> 0);
    const instructionIndex = unary ? 1 : 2;
    const inputs = [initial, initial];
    const reference = {fault: null, message: null, value: null, depth: 0};
    const actual = {...reference};
    for (let index = 0; index < cases; index++) {
      if ((index & 8191) === 0) {
        abortIfNeeded(signal);
        if (performance.now() > context.deadline) throw new Error('Numeric differential qualification exceeded its time limit');
        await new Promise(resolve => setImmediate(resolve));
      }
      operands(width, index, next, inputs);
      if (unary) inputs.length = 1;
      outcome(generic, inputs, instructionIndex, reference);
      outcome(optimized, inputs, instructionIndex, actual);
      if (!matching(reference, actual)) {
        throw new Error(`Numeric mismatch at ${width}/${operation}/${index}: ` + printable({inputs, reference, actual}));
      }
      row.completed++;
      report.completed++;
      if (reference.fault) row.faults++;
      if (width === 64) {
        if (inputs[0] >= -safeMaximum && inputs[0] <= safeMaximum &&
            (unary || inputs[1] >= -safeMaximum && inputs[1] <= safeMaximum)) row.safeInt64Operands++;
        else row.wideInt64Operands++;
      }
    }
  } finally {
    optimized?.stop();
    generic.stop();
  }
}

/** Real verified CIL step/dispatch differential; no compiled fixture is presented as a native CLR oracle. */
export async function numericDifferential(width, options, signal) {
  if (![32, 64].includes(width)) throw new RangeError('Differential width must be 32 or 64');
  if (![32, 64].includes(options.nativeBits)) throw new RangeError('Native integer width must be 32 or 64');
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
    throw new RangeError('Seed must be an unsigned 32-bit integer');
  }
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) {
    throw new RangeError('Differential time limit must be positive and at most 3600 seconds');
  }
  const count = width === 32 ? options.int32Cases : options.int64Cases;
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000000) throw new RangeError('Case count must be between 1 and 10000000');
  const required = width === 32 ? 1000000 : 10000000;
  const operations = width === 32 ? int32Operations : int64Operations;
  const report = {width, requested: count, completed: 0, requiredForAcceptance: required, status: 'running', operations: [],
    backend: 'JavaScript direct CIL, verifier-selected instruction handlers',
    reference: width === 32 ? 'Generic CLI handlers' : 'Generic pure-BigInt CLI handlers', nativeQualification: false};
  const started = performance.now();
  const context = {width, options, signal, report, deadline: started + options.timeoutSeconds * 1000};
  try {
    for (let index = 0; index < operations.length; index++) {
      const cases = Math.floor(count / operations.length) + Number(index < count % operations.length);
      if (cases) await compareOperation(context, operations[index], cases, index);
    }
    report.status = count >= required ? 'passed' : 'partial';
  } catch (error) {
    report.status = signal?.aborted ? 'cancelled' : 'failed';
    report.error = {name: error.name, message: error.message};
  }
  report.elapsedMs = performance.now() - started;
  report.meetsAcceptanceCount = report.status === 'passed' && report.completed >= required;
  return report;
}
