import {
  CilError
} from './binary.js';
import {
  resolveExecutionMethod,
  callSignatureKey,
  normalizeCallType
} from './call-profile.js';
import {
  validVarargsSignature
} from './varargs-profile.js';
import {
  validateTailPrefixes
} from './verify/prefix-tail.js';

const opcodes = new Set(['tail.', 'jmp', 'endfilter', 'arglist', 'mkrefany', 'refanyval', 'refanytype']);
export const isControlExecutableOpcode = name => opcodes.has(name);

export function controlStackEffect(method, instruction) {
  if (instruction.name === 'tail.' || instruction.name === 'jmp') return [0, 0];
  if (instruction.name === 'arglist') return [0, 1];
  if (instruction.name === 'endfilter') return [1, 0];
  if (['mkrefany', 'refanyval', 'refanytype'].includes(instruction.name)) return [1, 1];
  return null;
}

/** Match optional call-site operands against the exact declared fixed managed-vararg signature. */
export function verifyControlCall(inspector, descriptor) {
  const convention = descriptor.signature.callingConvention ?? 0;
  if (!convention) return;
  const name = descriptor.owner + '::' + descriptor.name;
  if (convention !== 5 || !descriptor.resolvedToken) {
    throw Object.assign(new CilError('Unmanaged vararg call is unavailable: ' + name), {
      code: 'IL_UNMANAGED',
      exceptionType: 'NotSupportedException',
      member: name
    });
  }
  const declaration = inspector.signature(descriptor.resolvedToken);
  if (!validVarargsSignature(declaration, descriptor.signature, callSignatureKey)) {
    throw new CilError('Managed vararg call does not match its fixed declaration: ' + name);
  }
}

/** Add execution admission while preserving the existing lexical prefix and exception-region verifier. */
export function verifyControlInstructions(inspector, method, context, issue, reachable, verifyType) {
  const tailCalls = new Map();
  try {
    if (method.instructions.some(instruction => instruction.name === 'tail.')) {
      const groups = validateTailPrefixes(inspector.pe.methodBody(method.token).code, method.handlers, inspector.options);
      for (const group of groups) for (const prefix of group.prefixes) {
        if (prefix.name === 'tail.') tailCalls.set(prefix.offset, group);
      }
    }
  } catch (error) {
    issue(method, null, error.code ?? 'IL_PREFIX', error.message);
  }
  for (let index = 0; index < method.instructions.length; index++) {
    const instruction = method.instructions[index];
    try {
      if (instruction.name === 'arglist' && method.signature.callingConvention !== 5) {
        throw new CilError('arglist requires a managed vararg method');
      }
      if (instruction.name === 'mkrefany' || instruction.name === 'refanyval') {
        const type = inspector.metadata.typeName(instruction.operand);
        if (type === 'void' || /[&*]$/.test(type)) throw new CilError('Typed reference requires a managed storage type');
        verifyType(inspector, type, context);
      }
      if (instruction.name === 'tail.') {
        const call = tailCalls.get(instruction.offset);
        if (!call) continue;
        const signature = call?.name === 'calli' ? inspector.signature(call.operand) :
          resolveExecutionMethod(inspector, call.operand, context).signature;
        if (normalizeCallType(signature.returnType) !== normalizeCallType(method.signature.returnType)) {
          throw new CilError('Tail call must preserve the caller return type');
        }
      }
      if (instruction.name === 'jmp') {
        const descriptor = resolveExecutionMethod(inspector, instruction.operand, context);
        if (!descriptor.resolvedToken || callSignatureKey(descriptor.signature) !== callSignatureKey(method.signature)) {
          throw new CilError('jmp requires an internal target with exactly the current signature');
        }
        reachable.push(descriptor.resolvedToken);
      }
    } catch (error) {
      issue(method, instruction, error.code ?? 'IL_CONTROL', error.message);
    }
  }
}
