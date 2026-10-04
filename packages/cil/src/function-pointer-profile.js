import {CilError} from './binary.js';
import {callSignatureKey} from './call-profile.js';
import {parseFunctionPointerType} from './function-pointer-signature.js';
import {functionPointerExecutionSignature, requireManagedCalli} from './function-pointer-execution-signature.js';
import {InstanceCalliTargets} from './instance-calli-targets.js';
import {VirtualPointerProfile} from './virtual-pointer-profile.js';
import {readExecutionSignatureAst, signatureSlotType} from './metadata/execution-signature.js';
import {instancePointerLocalSignature} from './instance-pointer-local.js';

const pointerKey = type => {
  const signature = parseFunctionPointerType(type);
  return signature ? callSignatureKey(signature) : null;
};
const slotIndex = instruction => instruction.operand ?? Number(instruction.name.split('.').at(-1));

export function indirectCallStackEffect(inspector, instruction) {
  const signature = inspector.signature(instruction.operand);
  return [signature.parameters.length + (signature.isStatic ? 0 : 1) + 1, signature.returnType === 'void' ? 0 : 1];
}

function merge(previous, incoming) {
  if (!previous) return incoming;
  if (previous.stack.length !== incoming.stack.length) return null;
  let changed = false;
  const join = (left, right) => left.map((value, index) => {
    const next = value === right[index] ? value : null;
    changed ||= value !== next;
    return next;
  });
  const result = {stack: join(previous.stack, incoming.stack), locals: join(previous.locals, incoming.locals),
    args: join(previous.args, incoming.args)};
  return changed ? result : null;
}

/** Cold per-verification cache; no stale AST facts survive metadata re-verification. */
export class FunctionPointerProfile {
  constructor(inspector, dispatch) {
    this.dispatch = dispatch;
    this.virtualPointers = null;
    this.inspector = inspector;
    this.signatures = new Map();
    this.instanceTargets = null;
    this.instanceKeys = new Set();
    this.localPointers = new Map();
  }

  signature(token) {
    if (!this.signatures.has(token)) this.signatures.set(token, functionPointerExecutionSignature(this.inspector, token));
    return this.signatures.get(token);
  }

  localPointer(method, index) {
    if (!method.localSignature) return null;
    if (!this.localPointers.has(method.localSignature)) {
      const ast = readExecutionSignatureAst(this.inspector.metadata, method.localSignature);
      this.localPointers.set(method.localSignature, ast.types.map((_, slot) =>
        instancePointerLocalSignature(this.inspector.metadata, signatureSlotType(ast, 'local', slot))));
    }
    return this.localPointers.get(method.localSignature)[index] ?? null;
  }

  indirect(instruction) {
    if (instruction.operand >>> 24 !== 17) throw new CilError('calli requires a StandAloneSig token');
    const signature = this.signature(instruction.operand);
    requireManagedCalli(signature);
    return signature;
  }

  method(token) {
    this.signature(token);
    const raw = this.inspector.resolveToken(token);
    const descriptor = {...raw, resolvedToken: raw.resolvedToken ?? (raw.token >>> 24 === 6 ? raw.token : null)};
    if (descriptor.resolvedToken) this.signature(descriptor.resolvedToken);
    return descriptor;
  }

  verifyOperand(method, instruction, context, issue, verifyType) {
    if (!['calli', 'ldftn', 'ldvirtftn'].includes(instruction.name)) return null;
    try {
      if (instruction.name === 'calli') {
        const signature = this.indirect(instruction);
        for (const type of signature.parameters.concat(signature.returnType)) verifyType(this.inspector, type, context);
        return null;
      }
      const descriptor = this.method(instruction.operand);
      if (descriptor.genericArguments || descriptor.signature.genericArity || /[!`]/.test(descriptor.owner)) {
        throw new CilError('Generic delegate targets require closed pointer binding');
      }
      if (!descriptor.resolvedToken) throw new CilError('External delegate target is not supported');
      if (instruction.name === 'ldvirtftn') {
        this.virtualPointers ??= new VirtualPointerProfile(this.inspector, this.dispatch);
        return this.virtualPointers.reachable(descriptor.resolvedToken);
      }
      return [descriptor.resolvedToken];
    } catch (error) {
      issue(method, instruction, error.code ?? (instruction.name === 'calli' ? 'IL_CALLI' : 'IL_TOKEN'), error.message,
        {exceptionType: error.exceptionType, callingConvention: error.callingConvention, member: method.owner + '::' + method.name});
      return null;
    }
  }

  check(value, signature, instruction, fail) {
    if (value !== callSignatureKey(signature)) fail(instruction, 'Managed function pointer signature is not proven compatible');
  }

  transfer(method, instruction, input, {effects, fail, escaped}) {
    const state = {stack: [...input.stack], locals: [...input.locals], args: [...input.args]}, name = instruction.name;
    if (name === 'ldftn' || name === 'ldvirtftn') {
      const descriptor = this.method(instruction.operand);
      if (!descriptor.signature.isStatic) this.instanceTargets ??= new InstanceCalliTargets(this.inspector);
      const virtual = name === 'ldvirtftn';
      if (virtual) state.stack.pop();
      const callable = virtual ? this.instanceTargets?.acceptsDeclaration(descriptor.resolvedToken)
        : descriptor.signature.isStatic || this.instanceTargets.accepts(descriptor.resolvedToken);
      const key = callable ? callSignatureKey(descriptor.signature) : null;
      if (key && !descriptor.signature.isStatic) this.instanceKeys.add(key);
      state.stack.push(key);
      return state;
    }
    if (/^ld(loc|arg)(\.[0-3s])?$/.test(name)) {
      state.stack.push((name.includes('loc') ? state.locals : state.args)[slotIndex(instruction)] ?? null);
      return state;
    }
    if (/^st(loc|arg)(\.[0-3s])?$/.test(name)) {
      const index = slotIndex(instruction), argument = name.includes('arg'), value = state.stack.pop() ?? null;
      if (!Number.isInteger(index) || index < 0 || index >= (argument ? state.args : state.locals).length) {
        throw new CilError('Invalid function-pointer storage slot');
      }
      const type = argument ? method.signature.parameters[index - (method.signature.isStatic ? 0 : 1)] : method.locals[index];
      const declared = (!argument && this.localPointer(method, index)) || type && parseFunctionPointerType(type);
      if (declared) this.check(value, declared, instruction, fail);
      const unproven = escaped[argument ? 'args' : 'locals'].has(index) || argument && this.instanceKeys.has(value);
      (argument ? state.args : state.locals)[index] = unproven ? null : value;
      return state;
    }
    if (name === 'dup') { state.stack.push(state.stack.at(-1) ?? null); return state; }
    if (name === 'conv.i' || name === 'conv.u') return state;
    let result = null;
    if (['call', 'callvirt', 'newobj', 'calli'].includes(name)) {
      const signature = name === 'calli' ? this.indirect(instruction) : this.method(instruction.operand).signature;
      if (name === 'calli') this.check(state.stack.at(-1) ?? null, signature, instruction, fail);
      const start = state.stack.length - signature.parameters.length - (name === 'calli' ? 1 : 0);
      signature.parameters.forEach((type, index) => {
        const declared = parseFunctionPointerType(type);
        if (declared) this.check(state.stack[start + index] ?? null, declared, instruction, fail);
      });
      result = pointerKey(signature.returnType);
    } else if (name === 'ret') {
      const signature = parseFunctionPointerType(method.signature.returnType);
      if (signature) this.check(state.stack.at(-1) ?? null, signature, instruction, fail);
    } else if (['ldsfld', 'ldfld', 'stsfld', 'stfld'].includes(name)) {
      const type = this.signature(instruction.operand).type;
      if (name.startsWith('ld')) result = pointerKey(type);
      else if (parseFunctionPointerType(type)) this.check(state.stack.at(-1) ?? null, parseFunctionPointerType(type), instruction, fail);
    }
    const [pop, push] = effects(this.inspector, method, instruction);
    state.stack.length = Math.max(0, state.stack.length - pop);
    for (let index = 0; index < push; index++) state.stack.push(result);
    if (name.startsWith('leave')) state.stack = [];
    return state;
  }

  /** Exact signature provenance through slots and CFG joins; malformed joins fail the main height verifier. */
  verify(method, issue, effects, peak) {
    const fail = (instruction, message, error = {}) => issue(method, instruction, error.code ?? 'IL_CALLI', message,
      {exceptionType: error.exceptionType, callingConvention: error.callingConvention, member: method.owner + '::' + method.name});
    try {
      this.signature(method.token);
      if (method.localSignature) this.signature(method.localSignature);
      let needed = method.signature.parameters.concat(method.locals, method.signature.returnType).some(type => type.startsWith('method '));
      // A caller can pass/store a forged pointer without invoking calli itself.
      for (const instruction of method.instructions) {
        if (['calli', 'ldftn', 'ldvirtftn'].includes(instruction.name)) needed = true;
        if (['call', 'callvirt', 'newobj'].includes(instruction.name)) {
          const signature = this.method(instruction.operand).signature;
          needed ||= signature.parameters.concat(signature.returnType).some(type => type.startsWith('method '));
        } else if (['ldfld', 'stfld', 'ldsfld', 'stsfld'].includes(instruction.name)) {
          const type = this.signature(instruction.operand).type;
          needed ||= type.startsWith('method ');
        }
      }
      if (!needed) return;
    } catch (error) { fail(null, error.message, error); return; }
    const width = peak + method.locals.length + method.signature.parameters.length + 1;
    let edges = method.instructions.length;
    for (const instruction of method.instructions) if (instruction.name === 'switch') edges += instruction.operand.length;
    if (edges * width > 262144) { fail(null, 'Function pointer analysis budget exceeded'); return; }
    const offsets = new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
    const escaped = {locals: new Set(), args: new Set()};
    for (const instruction of method.instructions) {
      if (/^ld(loc|arg)a(\.s)?$/.test(instruction.name)) {
        const kind = instruction.name.includes('loc') ? 'locals' : 'args', index = slotIndex(instruction);
        const limit = kind === 'locals' ? method.locals.length : method.signature.parameters.length + (method.signature.isStatic ? 0 : 1);
        if (kind === 'locals' && this.localPointer(method, index)) {
          fail(instruction, 'Addresses of typed instance function-pointer locals are not implemented');
        }
        if (index >= 0 && index < limit) escaped[kind].add(index);
      }
    }
    const args = method.signature.parameters.map(pointerKey);
    if (!method.signature.isStatic) args.unshift(null);
    for (const index of escaped.args) args[index] = null;
    const initial = {stack: [], locals: method.locals.map(() => null), args}, queue = [[0, initial]], states = new Map();
    for (const handler of method.handlers) {
      queue.push([offsets.get(handler.target), {...initial, stack: handler.flags === 0 ? [null] : [],
        locals: method.locals.map(() => null)}]);
    }
    let work = 0;
    while (queue.length) {
      if ((work += width) > 1048576) { fail(null, 'Function pointer analysis budget exceeded'); return; }
      const [index, input] = queue.pop(), instruction = method.instructions[index];
      if (!instruction) continue;
      const state = merge(states.get(index), input);
      if (!state) continue;
      states.set(index, state);
      let output;
      try { output = this.transfer(method, instruction, state, {effects, fail, escaped}); }
      catch (error) { fail(instruction, error.message, error); continue; }
      if (['ret', 'throw', 'rethrow', 'endfinally'].includes(instruction.name)) continue;
      if (instruction.operandKind.startsWith('br')) queue.push([offsets.get(instruction.operand), output]);
      if (instruction.name === 'switch') for (const target of instruction.operand) queue.push([offsets.get(target), output]);
      if (!/^(br|leave)(\.s)?$/.test(instruction.name)) queue.push([index + 1, output]);
    }
  }
}
