/**
 * C# 14 null-conditional assignment (SF-A02-T85): `a?.b = c`, `a?.b += c`, `a?[i] ??= c`, `a?.E += handler`.
 *
 * The syntax is a conditional access whose `whenNotNull` is an assignment with a member or element binding on its
 * left. The target is bound on the receiver of the access like any other binding, then the assignment is bound to
 * it with the rules of an ordinary assignment (writability, conversions, compound operators, events). The bound
 * tree is `ConditionalAccess { receiver, whenNotNull: Assignment | CompoundAssignment | ... }`, so the existing
 * lowering of null-conditional access (lowering/conditional-access.js) evaluates the receiver once and runs the
 * right side only when the receiver is not null. Nothing is lowered specially.
 *
 * The language-version gate (CS9260 below C# 14) is the parser's: it records `NullConditionalAssignment`.
 * `a?.b++` and `--a?.b` are not assignments in the grammar: they are an increment of a conditional access, which
 * is not a variable (CS1059, reported by the increment binder).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { checkWritable } from './ref-kinds.js';

/** True when `target` is a member of the value the conditional access tests (`s?.X` for a `Nullable<S>` receiver). */
function isMemberOfReceiverValue(target) {
  for (let current = target.receiver; current; current = current.receiver) if (current.kind === 'ConditionalReceiver') return true;
  return false;
}

/** Binder mixin: an assignment as the `whenNotNull` part of a conditional access. */
export const ConditionalAssignmentBinding = Base =>
  class extends Base {
    whenNotNull(syntax, receiver) {
      if (!syntax.kind.endsWith('AssignmentExpression')) return super.whenNotNull(syntax, receiver);
      const left = this.whenNotNull(syntax.left, receiver);
      // The value of a nullable struct receiver is a copy: its members are not variables (Roslyn reports CS0131, not CS1612).
      const writable = left.hasErrors ? null : checkWritable(left, 'assignment', this.variableContext);
      if (writable?.code === DiagnosticId.CS1612 && isMemberOfReceiverValue(left)) {
        this.report(syntax.left, DiagnosticId.CS0131);
        this.markWrite(left, null);
        this.value(syntax.right);
        return this.bad(syntax);
      }
      return this.assignmentTo(syntax, left);
    }
  };
