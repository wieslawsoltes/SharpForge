import {callSignatureKey, resolveExecutionMethod} from './call-profile.js';
import {parseFunctionPointerType} from './function-pointer-signature.js';

const unknown = Object.freeze([null]);
const valuesEqual = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);
function mergeValue(left, right) {
  if (valuesEqual(left, right)) return left;
  return [...new Set([...left, ...right])].sort();
}
function declaredPointer(type) {
  const signature = parseFunctionPointerType(type);
  return signature ? [callSignatureKey(signature)] : unknown;
}
function indexOf(instruction) {
  return instruction.operand ?? Number(instruction.name.split('.').at(-1));
}
function mergeState(previous, incoming) {
  if (!previous) return incoming;
  if (previous.stack.length !== incoming.stack.length) return null;
  let changed = false;
  const merge = (left, right) => left.map((value, index) => {
    const combined = mergeValue(value, right[index]);
    if (!valuesEqual(value, combined)) changed = true;
    return combined;
  });
  const next = {stack: merge(previous.stack, incoming.stack), locals: merge(previous.locals, incoming.locals),
    args: merge(previous.args, incoming.args)};
  return changed ? next : null;
}

function verifyValue(value, signature, instruction, fail) {
  const expected = callSignatureKey(signature);
  if (value.some(key => key !== expected)) fail(instruction, 'Managed function pointer signature is not proven compatible');
}

function transfer(inspector, method, instruction, state, effects, fail) {
  const next = {stack: [...state.stack], locals: [...state.locals], args: [...state.args]};
  const name = instruction.name;
  if (name === 'ldftn' || name === 'ldvirtftn') {
    if (name === 'ldvirtftn') next.stack.pop();
    next.stack.push([callSignatureKey(resolveExecutionMethod(inspector, instruction.operand).signature)]);
    return next;
  }
  if (/^ld(loc|arg)(\.[0-3s])?$/.test(name)) {
    next.stack.push((name.includes('loc') ? next.locals : next.args)[indexOf(instruction)] ?? unknown);
    return next;
  }
  if (/^st(loc|arg)(\.[0-3s])?$/.test(name)) {
    const index = indexOf(instruction);
    const argument = name.includes('arg');
    const type = argument ? method.signature.parameters[index - (method.signature.isStatic ? 0 : 1)] : method.locals[index];
    const value = next.stack.pop() ?? unknown;
    const declared = type && parseFunctionPointerType(type);
    if (declared) verifyValue(value, declared, instruction, fail);
    (argument ? next.args : next.locals)[index] = value;
    return next;
  }
  if (name === 'dup') { next.stack.push(next.stack.at(-1) ?? unknown); return next; }
  if (name === 'conv.i' || name === 'conv.u') return next;
  if (name === 'calli') {
    const signature = inspector.signature(instruction.operand);
    verifyValue(next.stack.at(-1) ?? unknown, signature, instruction, fail);
  }
  let result = unknown;
  if (['call', 'callvirt', 'newobj'].includes(name)) {
    const signature = resolveExecutionMethod(inspector, instruction.operand).signature;
    const start = next.stack.length - signature.parameters.length;
    signature.parameters.forEach((type, index) => {
      const pointer = parseFunctionPointerType(type);
      if (pointer) verifyValue(next.stack[start + index] ?? unknown, pointer, instruction, fail);
    });
    result = declaredPointer(signature.returnType);
  } else if (name === 'ret') {
    const signature = parseFunctionPointerType(method.signature.returnType);
    if (signature) verifyValue(next.stack.at(-1) ?? unknown, signature, instruction, fail);
  } else if (['ldsfld', 'ldfld'].includes(name)) {
    result = declaredPointer(inspector.signature(instruction.operand).type);
  }
  const [pop, push] = effects(inspector, method, instruction);
  next.stack.length = Math.max(0, next.stack.length - pop);
  for (let index = 0; index < push; index++) next.stack.push(result);
  if (name.startsWith('leave')) next.stack = [];
  return next;
}

/** Bounded CFG analysis tracks pointer signatures through locals, arguments and joins. */
export function verifyManagedFunctionPointers(inspector, method, issue, effects) {
  if (!method.instructions.some(instruction => ['calli', 'ldftn', 'ldvirtftn'].includes(instruction.name)) &&
      !method.signature.parameters.some(type => type.startsWith('method '))) return;
  const fail = (instruction, message) => issue(method, instruction, 'IL_CALLI', message);
  const offsets = new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
  const args = method.signature.parameters.map(declaredPointer);
  if (!method.signature.isStatic) args.unshift(unknown);
  const initial = {stack: [], locals: method.locals.map(() => unknown), args};
  const queue = [[0, initial]];
  for (const handler of method.handlers) {
    const state = {...initial, stack: handler.flags === 0 || handler.flags === 1 ? [unknown] : [],
      locals: method.locals.map(declaredPointer)};
    queue.push([offsets.get(handler.target), state]);
    if (handler.flags === 1) queue.push([offsets.get(handler.catchType), {...state, stack: [unknown]}]);
  }
  const states = new Map();
  let work = 0;
  while (queue.length) {
    if (++work > method.instructions.length * 256 + 1024) { fail(null, 'Function pointer analysis budget exceeded'); return; }
    const [index, input] = queue.pop();
    const instruction = method.instructions[index];
    if (!instruction) continue;
    const merged = mergeState(states.get(index), input);
    if (!merged) continue;
    states.set(index, merged);
    let output;
    try { output = transfer(inspector, method, instruction, merged, effects, fail); }
    catch (error) { fail(instruction, error.message); continue; }
    if (['ret', 'jmp', 'throw', 'rethrow', 'endfilter', 'endfinally'].includes(instruction.name)) continue;
    if (instruction.operandKind.startsWith('br')) queue.push([offsets.get(instruction.operand), output]);
    if (instruction.name === 'switch') for (const target of instruction.operand) queue.push([offsets.get(target), output]);
    if (!/^(br|leave)(\.s)?$/.test(instruction.name)) queue.push([index + 1, output]);
  }
}

/** Unsupported unmanaged calls retain a structured managed failure at load time. */
export function verifyIndirectSignature(inspector, method, instruction, issue, illegalType) {
  try {
    const signature = inspector.signature(instruction.operand);
    if (signature.callingConvention) {
      const member = method.owner + '::' + method.name;
      issue(method, instruction, 'IL_UNMANAGED', 'Unmanaged calli is unavailable in ' + member,
        {exceptionType: 'NotSupportedException', member, callingConvention: signature.callingConvention});
      return;
    }
    if (instruction.operand >>> 24 !== 17 || signature.kind !== 'method' || signature.genericArity ||
        signature.parameters.concat(signature.returnType).some(illegalType)) {
      issue(method, instruction, 'IL_SIGNATURE', 'calli requires a managed StandAloneSig');
    }
  } catch (error) { issue(method, instruction, 'IL_SIGNATURE', error.message); }
}
