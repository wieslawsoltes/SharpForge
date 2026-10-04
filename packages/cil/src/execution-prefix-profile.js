import {resolveExecutionMethod} from './call-profile.js';
import {verifyGenericType} from './generic-profile.js';
import {validateTypePrefixes} from './verify/prefix-constrained.js';
import {validateMemoryPrefixes} from './verify/prefix-memory.js';
import {ConstrainedObjectProfile} from './constrained-object-profile.js';
import {admitConstrainedObject, verifyObjectCalls} from './constrained-object-admission.js';

const supported = new Set(['volatile.', 'unaligned.', 'readonly.', 'constrained.', 'tail.']);

/** Executable prefix groups retain their flat debugger offsets and may only be entered at the prefix. */
export class ExecutionPrefixProfile {
  constructor(inspector, dispatch) {
    this.inspector = inspector;
    this.objects = new ConstrainedObjectProfile(inspector);
    this.types = this.objects.types;
    this.genericOwners = this.objects.genericOwners;
    this.dispatch = dispatch;
    this.references = null;
  }

  constrained(prefix, next, context, reachable, method) {
    if (next?.name !== 'callvirt') return 'constrained. must immediately precede callvirt';
    const name = this.inspector.metadata.typeName(prefix.operand);
    const parameter = prefix.operand >>> 24 === 27 && /^!!?\d+$/.test(name);
    if (parameter) verifyGenericType(this.inspector, name, context);
    const declaration = resolveExecutionMethod(this.inspector, next.operand, context);
    const object = admitConstrainedObject(this, {prefix, descriptor: declaration, method, context}, reachable);
    if (object !== undefined) return object;
    const type = this.types.get(prefix.operand);
    const base = type?.baseToken ? this.inspector.metadata.typeName(type.baseToken) : null;
    if (!parameter && (!type || !base || type.flags & 0x20 || base === 'System.Enum' || this.genericOwners.has(type.token))) {
      return 'constrained. execution requires a nongeneric class or user-struct TypeDef';
    }
    const owner = this.types.get(declaration.ownerToken);
    if (!owner || this.genericOwners.has(owner.token) ||
        declaration.signature.isStatic || declaration.signature.genericArity || declaration.methodArguments?.length) {
      return base === 'System.ValueType' ? 'constrained. execution requires a nongeneric interface instance method'
        : 'constrained. execution requires a nongeneric internal class or interface instance method';
    }
    if (base === 'System.ValueType' && !(owner.flags & 0x20)) {
      return 'constrained. user-struct execution requires a nongeneric interface instance method';
    }
    const ownerBase = owner.baseToken ? this.inspector.metadata.typeName(owner.baseToken) : null;
    if (base !== 'System.ValueType' && (ownerBase === 'System.ValueType' || ownerBase === 'System.Enum')) {
      return 'constrained. class execution requires a reference-type member declaration';
    }
    return null;
  }

  verify(method, context, issue, reachable) {
    verifyObjectCalls(this, method, context, issue, reachable);
    if (!method.instructions.some(instruction => supported.has(instruction.name))) return;
    let groups;
    try {
      const code = this.inspector.pe.methodBody(method.token).code;
      groups = validateMemoryPrefixes(code);
      if (method.instructions.some(instruction => ['constrained.', 'readonly.'].includes(instruction.name))) {
        validateTypePrefixes(code, this.inspector.metadata);
      }
    } catch (error) {
      issue(method, method.instructions.find(instruction => instruction.offset === error.offset), 'IL_PREFIX', error.message);
      return;
    }
    const tails = new Set();
    for (const group of groups) {
      if (!group.prefixes.length) continue;
      tails.add(group.opcodeOffset);
      for (const prefix of group.prefixes) {
        if (prefix.offset !== group.offset) tails.add(prefix.offset);
        if (prefix.name !== 'constrained.') continue;
        try {
          const error = this.constrained(prefix, group, context, reachable, method);
          if (error) issue(method, prefix, 'IL_PREFIX', error);
        } catch (error) {
          issue(method, prefix, 'IL_TOKEN', error.message);
        }
      }
    }
    for (const handler of method.handlers) {
      const boundaries = [handler.start, handler.end, handler.target, handler.handlerEnd];
      if (handler.flags === 1) boundaries.push(handler.catchType);
      if (boundaries.some(offset => tails.has(offset))) {
        issue(method, null, 'IL_PREFIX', 'An exception region cannot split an instruction prefix');
      }
    }
  }
}
