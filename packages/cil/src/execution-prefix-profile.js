import {resolveExecutionMethod} from './call-profile.js';
import {verifyGenericType} from './generic-profile.js';
import {validateTypePrefixes} from './verify/prefix-constrained.js';
import {ConstrainedObjectProfile} from './constrained-object-profile.js';
import {ConstrainedReferenceObjectProfile} from './constrained-reference-object-profile.js';

const supported = new Set(['volatile.', 'constrained.']);
const memoryTargets = new Set(['ldfld', 'stfld', 'ldsfld', 'stsfld', 'ldobj', 'stobj']);

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

  constrained(prefix, next, context, reachable) {
    if (next?.name !== 'callvirt') return 'constrained. must immediately precede callvirt';
    const name = this.inspector.metadata.typeName(prefix.operand);
    const parameter = prefix.operand >>> 24 === 27 && /^!!?\d+$/.test(name);
    if (parameter) verifyGenericType(this.inspector, name, context);
    const declaration = resolveExecutionMethod(this.inspector, next.operand, context);
    if (this.objects.primitive(prefix.operand, declaration)) return null;
    const type = this.types.get(prefix.operand);
    const base = type?.baseToken ? this.inspector.metadata.typeName(type.baseToken) : null;
    if (!parameter && (!type || !base || type.flags & 0x20 || base === 'System.Enum' || this.genericOwners.has(type.token))) {
      return 'constrained. execution requires a nongeneric class or user-struct TypeDef';
    }
    const object = !parameter && this.objects.select(prefix.operand, declaration);
    if (object) {
      if (object.target) reachable.push(object.target);
      reachable.push(...object.initializers);
      return null;
    }
    if (!parameter && this.objects.declaration(declaration)) {
      this.references ??= new ConstrainedReferenceObjectProfile(this.inspector, this.objects, this.dispatch);
      if (this.references.select(prefix.operand, declaration)) {
        for (const target of this.references.targets(prefix.operand)) reachable.push(target);
        return null;
      }
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
    if (method.instructions.some(instruction => instruction.name === 'constrained.')) {
      try {
        // Reuse the lexical verifier without changing its broader inspection profile.
        validateTypePrefixes(this.inspector.pe.methodBody(method.token).code, this.inspector.metadata);
      } catch (error) {
        issue(method, null, 'IL_PREFIX', error.message);
        return;
      }
    }
    const tails = new Set();
    for (let index = 0; index < method.instructions.length; index++) {
      const prefix = method.instructions[index];
      if (!supported.has(prefix.name)) continue;
      const next = method.instructions[index + 1];
      if (next) tails.add(next.offset);
      try {
        let error;
        if (prefix.name === 'constrained.') error = this.constrained(prefix, next, context, reachable);
        else if (!next || !memoryTargets.has(next.name) && !next.name.startsWith('ldind.') && !next.name.startsWith('stind.')) {
          error = 'volatile. must precede a supported memory instruction';
        }
        if (error) issue(method, prefix, 'IL_PREFIX', error);
      } catch (error) {
        issue(method, prefix, 'IL_TOKEN', error.message);
      }
    }
    for (const instruction of method.instructions) {
      const targets = instruction.name === 'switch' ? instruction.operand
        : instruction.operandKind.startsWith('br') ? [instruction.operand] : [];
      if (targets.some(target => tails.has(target))) {
        issue(method, instruction, 'IL_PREFIX', 'Control flow cannot enter a prefixed instruction after its prefix');
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
