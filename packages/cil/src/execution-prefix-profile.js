import {decodeCoded} from './metadata.js';
import {resolveExecutionMethod} from './call-profile.js';

const supported = new Set(['volatile.', 'constrained.']);
const memoryTargets = new Set(['ldfld', 'stfld', 'ldsfld', 'stsfld', 'ldobj', 'stobj']);

/** Executable prefix groups retain their flat debugger offsets and may only be entered at the prefix. */
export class ExecutionPrefixProfile {
  constructor(inspector) {
    this.inspector = inspector;
    this.types = new Map(inspector.types.map(type => [type.token, type]));
    this.genericOwners = new Set((inspector.metadata.rows?.[42] ?? [])
      .map(row => decodeCoded('TypeOrMethodDef', row[2])));
  }

  constrained(prefix, next, context) {
    if (next?.name !== 'callvirt') return 'constrained. must immediately precede callvirt';
    const type = this.types.get(prefix.operand);
    if (!type || !type.baseToken || this.inspector.metadata.typeName(type.baseToken) !== 'System.ValueType' ||
        this.genericOwners.has(type.token)) {
      return 'constrained. execution requires a nongeneric user-struct TypeDef';
    }
    const declaration = resolveExecutionMethod(this.inspector, next.operand, context);
    const owner = this.types.get(declaration.ownerToken);
    if (!owner || !(owner.flags & 0x20) || this.genericOwners.has(owner.token) ||
        declaration.signature.isStatic || declaration.signature.genericArity || declaration.methodArguments?.length) {
      return 'constrained. execution requires a nongeneric interface instance method';
    }
    return null;
  }

  verify(method, context, issue) {
    const tails = new Set();
    for (let index = 0; index < method.instructions.length; index++) {
      const prefix = method.instructions[index];
      if (!supported.has(prefix.name)) continue;
      const next = method.instructions[index + 1];
      if (next) tails.add(next.offset);
      try {
        let error;
        if (prefix.name === 'constrained.') error = this.constrained(prefix, next, context);
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
