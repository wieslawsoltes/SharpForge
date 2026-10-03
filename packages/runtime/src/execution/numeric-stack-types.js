import {stackEffect, callStorageType, resolveExecutionMethod, resolveExecutionField} from '@sharpforge/cil';
import {numericTypeName} from '@sharpforge/bytecode';

export const StackCategory = Object.freeze({unknown: 0, i4: 1, i8: 2, r4: 3, r8: 4, native: 5, reference: 6, byref: 7});
const C = StackCategory;
const small = new Set(['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint']);
const numeric = new Set([C.i4, C.i8, C.r4, C.r8, C.native]);
const arithmetic = /^(add|sub|mul|div|rem|and|or|xor|shl|shr)(\.|$)/;
const conditional = /^b(eq|ge|gt|le|lt|ne|rtrue|rfalse)(\.|$)/;
const terminal = new Set(['ret', 'throw', 'rethrow', 'endfinally', 'endfilter', 'jmp']);

function category(type) {
  if (typeof type !== 'string') return C.unknown;
  type = callStorageType(type);
  if (type.endsWith('&') || type.endsWith('*')) return C.byref;
  type = numericTypeName(type);
  if (small.has(type)) return C.i4;
  if (type === 'long' || type === 'ulong') return C.i8;
  if (type === 'float') return C.r4;
  if (type === 'double') return C.r8;
  if (type === 'nint' || type === 'nuint') return C.native;
  if (['object', 'string', 'System.Object', 'System.String'].includes(type) || type.endsWith(']')) return C.reference;
  return C.unknown;
}

function suffixCategory(name) {
  const suffix = name.split('.').at(-1);
  if (['i1', 'u1', 'i2', 'u2', 'i4', 'u4'].includes(suffix)) return C.i4;
  if (suffix === 'i8') return C.i8;
  if (suffix === 'r4') return C.r4;
  if (suffix === 'r8') return C.r8;
  if (suffix === 'i') return C.native;
  if (suffix === 'ref') return C.reference;
  return C.unknown;
}

function arithmeticResult(name, left, right) {
  if (!numeric.has(left) || !numeric.has(right)) return C.unknown;
  if (name.startsWith('sh') && [C.i4, C.i8, C.native].includes(right)) return left;
  if (left === right) return left;
  if ([C.r4, C.r8].includes(left) && [C.r4, C.r8].includes(right)) return C.r8;
  if ([left, right].includes(C.native) && [left, right].includes(C.i4)) return C.native;
  return C.unknown;
}

function loadCategory(inspector, method, instruction, stack) {
  const name = instruction.name;
  if (name.startsWith('ldc.i4') || name === 'sizeof' || name === 'ldlen' || ['ceq', 'cgt', 'clt', 'cgt.un', 'clt.un'].includes(name)) {
    return C.i4;
  }
  if (name === 'ldc.i8') return C.i8;
  if (name === 'ldc.r4') return C.r4;
  if (name === 'ldc.r8') return C.r8;
  if (name === 'ldnull' || name === 'ldstr' || name === 'newarr' || name === 'box') return C.reference;
  if (/^ld(arg|loc)a/.test(name) || ['ldflda', 'ldsflda', 'ldelema', 'unbox'].includes(name)) return C.byref;
  if (/^ld(arg|loc)(\.|$)/.test(name)) {
    const index = instruction.operand ?? Number(name.split('.').at(-1));
    if (name.startsWith('ldloc')) return category(method.locals[index]);
    const parameter = index - Number(!method.signature.isStatic);
    return parameter < 0 ? C.unknown : category(method.signature.parameters[parameter]);
  }
  if (name.startsWith('conv.')) {
    const target = name.replace(/^conv\.(ovf\.)?/, '').replace(/\.un$/, '');
    return ({i1: C.i4, u1: C.i4, i2: C.i4, u2: C.i4, i4: C.i4, u4: C.i4,
      i8: C.i8, u8: C.i8, r4: C.r4, r8: C.r8, r: C.r8, i: C.native, u: C.native})[target] ?? C.unknown;
  }
  if (name.startsWith('ldind.') || name.startsWith('ldelem.')) return suffixCategory(name);
  if (arithmetic.test(name)) return arithmeticResult(name, stack.at(-2), stack.at(-1));
  if (name === 'neg' || name === 'not' || name === 'ckfinite') return stack.at(-1);
  if (name === 'castclass' || name === 'isinst') return C.reference;
  if (['ldobj', 'ldelem', 'unbox.any'].includes(name)) return category(inspector.metadata.typeName(instruction.operand));
  if (name === 'ldfld' || name === 'ldsfld') {
    const field = resolveExecutionField(inspector, instruction.operand, method.typeArguments ?? []);
    return category(field.signature.type);
  }
  if (name === 'call' || name === 'callvirt') {
    const descriptor = resolveExecutionMethod(inspector, instruction.operand, {ownerToken: method.ownerToken,
      genericIdentity: method.genericIdentity, typeArguments: method.typeArguments, methodArguments: method.methodArguments});
    // Managed returns normalize through storage. External adapters retain their
    // own representation contracts, so their raw result is not a numeric proof.
    return descriptor.resolvedToken ? category(descriptor.signature.returnType) : C.unknown;
  }
  return C.unknown;
}

function transfer(inspector, method, instruction, before) {
  const [pop, push] = stackEffect(inspector, method, instruction);
  const after = before.slice(0, before.length - pop);
  if (instruction.name === 'dup') after.push(before.at(-1), before.at(-1));
  else if (push) {
    let result = C.unknown;
    try { result = loadCategory(inspector, method, instruction, before); }
    catch { /* Unknown metadata/type facts never authorize a specialized handler. */ }
    for (let i = 0; i < push; i++) after.push(result);
  }
  return after;
}

/**
 * Conservative numeric type facts for an already verified method. This is not a
 * second verifier: unsupported or disagreeing facts become unknown. A category
 * can change only once after first reaching a slot (known -> unknown), bounding
 * work by the instruction count times verified maxstack.
 */
export function numericStackTypes(inspector, method, offsets) {
  const instructions = method.instructions, states = Array(instructions.length).fill(null);
  const queued = new Uint8Array(instructions.length), work = [];
  function merge(index, incoming) {
    if (!Number.isInteger(index) || index < 0 || index >= instructions.length) return;
    const previous = states[index];
    let changed = !previous;
    if (!previous) states[index] = incoming.slice();
    else {
      for (let i = 0; i < previous.length; i++) {
        if (previous[i] !== C.unknown && previous[i] !== incoming[i]) {
          previous[i] = C.unknown;
          changed = true;
        }
      }
    }
    if (changed && !queued[index]) { work.push(index); queued[index] = 1; }
  }
  merge(0, []);
  for (const handler of method.handlers) {
    merge(offsets.get(handler.target), handler.flags === 0 || handler.flags === 1 ? [C.reference] : []);
    if (handler.flags === 1) merge(offsets.get(handler.catchType), [C.reference]);
  }
  while (work.length) {
    const index = work.pop(), instruction = instructions[index];
    queued[index] = 0;
    const after = transfer(inspector, method, instruction, states[index]);
    const name = instruction.name;
    if (terminal.has(name)) continue;
    if (name === 'switch') {
      for (const target of instruction.operand) merge(offsets.get(target), after);
    } else if (instruction.operandKind.startsWith('br')) {
      merge(offsets.get(instruction.operand), name.startsWith('leave') ? [] : after);
      if (!conditional.test(name)) continue;
    }
    merge(index + 1, after);
  }
  return states.map(state => state && Object.freeze(state));
}
