/**
 * The nullable analysis attributes in the flow walker (SF-A02-T05.5; read by nullable/attributes.js):
 *
 *   [DoesNotReturnIf(b)] bool p        after the call the argument is known to be `!b` (`Assert(x != null)`)
 *   [return: NotNullIfNotNull("p")]    the result is not null when the argument of one of the named parameters is not
 *   [MemberNotNull] / [MemberNotNullWhen(b)] on a property: reading it (or testing it) proves the named members
 *   [AllowNull] / [DisallowNull] on a parameter: its state when the method body starts
 *   [AllowNull] on a non-nullable member: a null may be stored, the member still reads as not null
 *
 * The attributes of out, ref and value arguments ([NotNull], [MaybeNull], [NotNullWhen], [MaybeNullWhen]) and
 * [DoesNotReturn] are applied by the walker core, where calls are walked.
 */
import { NOT_NULL, MAYBE_NULL } from './flow-state.js';
import { NullableAnnotation } from '../symbols/types.js';
import { allowsNull, disallowsNull, doesNotReturnIf, membersNotNullAfterCall, notNullIfNotNullParameters } from './attributes.js';

/** Class mixin over the condition rules of the nullable walker. */
export const NullableAttributeRules = Base =>
  class extends Base {
    argument(argument, method, flow) {
      const stopsWhen = argument.parameter ? doesNotReturnIf(argument.parameter) : null;
      if (stopsWhen === null) return super.argument(argument, method, flow);
      // The call returns only where the condition is the other value: that branch is what follows the call.
      const branches = this.condition(argument.expression ?? argument, flow),
        after = stopsWhen ? branches.whenFalse : branches.whenTrue;
      if (after) this.replace(flow, after);
      else this.markUnreachable(flow);
      return NOT_NULL;
    }

    callResult(node, method, argumentStates) {
      const state = super.callResult(node, method, argumentStates);
      if (state !== MAYBE_NULL) return state;
      const names = notNullIfNotNullParameters(method);
      if (!names.length) return state;
      const isNotNull = (node.args ?? []).some((argument, index) => names.includes(argument.parameter?.name) && argumentStates[index] === NOT_NULL);
      return isNotNull ? NOT_NULL : state;
    }

    condition(node, flow) {
      const property = flow && node.kind === 'PropertyAccess' ? node.property : null;
      if (!property || !membersNotNullAfterCall(property, true).concat(membersNotNullAfterCall(property, false)).length) {
        return super.condition(node, flow);
      }
      this.expression(node, flow);
      const whenFalse = flow.clone();
      this.applyMemberPostconditions(property, true, flow, node.receiver);
      this.applyMemberPostconditions(property, false, whenFalse, node.receiver);
      return { whenTrue: flow, whenFalse };
    }

    memberAccess(node, flow) {
      const state = super.memberAccess(node, flow);
      if (node.property) this.applyMemberPostconditions(node.property, null, flow, node.receiver);
      return state;
    }

    declaredState(expression) {
      const parameter = expression.kind === 'Parameter' ? expression.parameter : null;
      if (parameter && disallowsNull(parameter)) return NOT_NULL;
      if (parameter && allowsNull(parameter)) return MAYBE_NULL;
      return super.declaredState(expression);
    }

    assignment(node, flow) {
      const state = super.assignment(node, flow),
        target = node.left,
        member = target.field ?? target.property;
      // An [AllowNull] member of a non-nullable type takes a null but does not give one back.
      if (member && allowsNull(member) && this.declaredAnnotation(target) === NullableAnnotation.NotAnnotated) {
        const variable = this.variableOf(target);
        if (variable) flow.set(variable, NOT_NULL);
      }
      return state;
    }
  };
