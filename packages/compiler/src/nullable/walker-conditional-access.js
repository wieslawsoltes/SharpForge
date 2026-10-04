/**
 * Null-state learned from a test of a conditional access (SF-A02-T05.4).
 *
 * `a?.b` is evaluated only where `a` is not null, so a test that can only succeed when the access produced a value
 * proves the receiver - and every receiver of a chain `a?.b?.c` - not null on that branch:
 *
 *   a?.b > 0, a?.b == 3, a?.b == other     true: a is not null (a lifted comparison with a missing value is false,
 *                                          and a missing value is not equal to a value that is not null)
 *   a?.b != 3                              false: a is not null
 *   a?.b != null, a?.b is not null         true: a is not null;   a?.b == null, a?.b is null   false: a is not null
 *   a?.b is T, is 3, is > 3, is { }        true: a is not null (these patterns never match null)
 *   a?.b ?? false                          true: a is not null;   a?.b ?? true   false: a is not null
 *
 * On the other branch the access may have been skipped or evaluated, so the two paths are joined.
 */
import { NOT_NULL, MAYBE_NULL, joinFlow } from './flow-state.js';
import { nullMatch, isNullLiteral, withoutConversions as unwrap } from './pattern-nullness.js';

const relationalOperators = new Set(['<', '>', '<=', '>=']);
const equalityOperators = new Set(['==', '!=']);
const isAccess = node => unwrap(node)?.kind === 'ConditionalAccess';
const boolConstant = node => {
  const value = unwrap(node)?.constantValue?.value;
  return typeof value === 'boolean' ? value : null;
};

/** Class mixin over the condition rules of the nullable walker. */
export const NullableConditionalAccess = Base =>
  class extends Base {
    condition(node, flow) {
      if (!flow) return super.condition(node, flow);
      let learned = null;
      if (node.kind === 'Binary' && !node.method) learned = this.accessComparison(node, flow);
      else if (node.kind === 'Is' || node.kind === 'IsPattern') learned = this.accessPatternTest(node, flow);
      else if (node.kind === 'Coalesce') learned = this.accessCoalesce(node, flow);
      return learned ?? super.condition(node, flow);
    }

    /** `a?.b` as a value: afterwards the access was either evaluated or skipped, and the value may be missing. */
    expression(node, flow) {
      if (node?.kind !== 'ConditionalAccess' || !flow || node.suppressed) return super.expression(node, flow);
      const paths = this.accessPaths(node, flow);
      this.replace(flow, joinFlow(paths.evaluated, paths.skipped));
      return MAYBE_NULL;
    }

    /**
     * Walks `a?.b` (or a chain of accesses) on `flow`.
     * @returns {{evaluated: object, skipped: object, state: string, value: object|null}} the flow where every access
     *   produced its value (`flow` itself), the flow where one was skipped, the null-state of the value produced and
     *   the variable that value is read from, if it is one
     */
    accessPaths(access, flow) {
      this.expression(access.receiver, flow);
      const receiver = this.variableOf(access.receiver),
        skipped = flow.clone();
      if (receiver) {
        skipped.set(receiver, MAYBE_NULL);
        flow.set(receiver, NOT_NULL);
      }
      // The receiver placeholder inside the access stands for the receiver variable (`a?.b?.c` proves `a.b` not null).
      return this.withConditionalReceiver(receiver, () => {
        if (access.whenNotNull?.kind !== 'ConditionalAccess') {
          const state = this.expression(access.whenNotNull, flow);
          const isMissable = access.whenNotNull?.type?.isNullableValueType === true;
          const leaf = access.whenNotNull;
          return { evaluated: flow, skipped, state: isMissable ? MAYBE_NULL : state, value: this.variableOf(leaf), leaf, receiver };
        }
        const nested = this.accessPaths(access.whenNotNull, flow);
        return { ...nested, skipped: joinFlow(skipped, nested.skipped) };
      });
    }

    /** The flow where the access produced a value that is not null: the variable it was read from is not null there. */
    withValue(flow, paths) {
      if (paths.value) flow.set(paths.value, NOT_NULL);
      return flow;
    }

    /** `a?.Has == true`: where the comparison succeeds, the member tested returned that value and its postconditions hold. */
    applyLeafPostconditions(paths, returned, flow) {
      const leaf = paths.leaf,
        member = leaf?.kind === 'PropertyAccess' ? leaf.property : leaf?.kind === 'Call' ? leaf.method : null;
      if (!member || returned === null) return;
      this.withConditionalReceiver(paths.receiver, () => {
        for (const argument of leaf.args ?? []) this.applyPostcondition(argument, returned, flow);
        this.applyMemberPostconditions(member, returned, flow, leaf.receiver);
      });
    }

    /** An operand of a comparison: the paths of a conditional access, or a value that is always evaluated. */
    operandPaths(operand, flow) {
      const inner = unwrap(operand);
      if (inner.kind === 'ConditionalAccess') return this.accessPaths(inner, flow);
      const state = this.expression(operand, flow);
      // A nullable value type is not tracked: it may be null whatever its state says.
      const isNotNull = state === NOT_NULL && inner.type?.isNullableValueType !== true && !isNullLiteral(operand);
      return { evaluated: flow, skipped: null, state: isNotNull ? NOT_NULL : MAYBE_NULL };
    }

    accessComparison(node, flow) {
      const isEquality = equalityOperators.has(node.operator);
      if (!isEquality && !relationalOperators.has(node.operator)) return null;
      const leftIsAccess = isAccess(node.left),
        rightIsAccess = isAccess(node.right);
      if (!leftIsAccess && !rightIsAccess) return null;
      // The right operand is evaluated whether or not the left access was skipped.
      const left = this.operandPaths(node.left, flow),
        rightAfterSkip = left.skipped ? this.operandPaths(node.right, left.skipped) : null,
        right = this.operandPaths(node.right, left.evaluated);
      const allEvaluated = right.evaluated,
        someSkipped = joinFlow(right.skipped, rightAfterSkip && joinFlow(rightAfterSkip.evaluated, rightAfterSkip.skipped)),
        either = () => joinFlow(allEvaluated, someSkipped);
      if (!isEquality) return { whenTrue: allEvaluated, whenFalse: either() };
      const access = leftIsAccess ? left : right,
        other = leftIsAccess ? node.right : node.left,
        otherPaths = leftIsAccess ? right : left;
      let whenEqual, whenDifferent;
      if (isNullLiteral(other)) {
        // Equal to null: the access was skipped, or it produced a null value.
        whenEqual = joinFlow(someSkipped, access.state === MAYBE_NULL ? allEvaluated : null);
        whenDifferent = this.withValue(allEvaluated, access);
      } else if (leftIsAccess !== rightIsAccess && otherPaths.state === NOT_NULL) {
        whenDifferent = either();
        whenEqual = this.withValue(allEvaluated, access);
        this.applyLeafPostconditions(access, boolConstant(other), whenEqual);
      } else {
        // Two accesses, or a value that may be null itself: equality proves nothing about either.
        whenEqual = either();
        whenDifferent = either();
      }
      return node.operator === '==' ? { whenTrue: whenEqual, whenFalse: whenDifferent } : { whenTrue: whenDifferent, whenFalse: whenEqual };
    }

    accessPatternTest(node, flow) {
      const access = unwrap(node.operand);
      if (access?.kind !== 'ConditionalAccess') return null;
      const paths = this.accessPaths(access, flow),
        match = nullMatch(node.kind === 'IsPattern' ? node.pattern : null),
        either = () => joinFlow(paths.evaluated, paths.skipped);
      if (match === 'maybe') return { whenTrue: either(), whenFalse: either() };
      if (match === 'only') {
        const whenTrue = joinFlow(paths.skipped, paths.state === MAYBE_NULL ? paths.evaluated : null);
        return { whenTrue, whenFalse: this.withValue(paths.evaluated, paths) };
      }
      const whenFalse = either();
      if (node.pattern?.local) paths.evaluated.set(node.pattern.local, NOT_NULL);
      return { whenTrue: this.withValue(paths.evaluated, paths), whenFalse };
    }

    /** `a?.b ?? c` as a condition: where the access produced a value the result is that value, elsewhere it is `c`. */
    accessCoalesce(node, flow) {
      const access = unwrap(node.left);
      if (access?.kind !== 'ConditionalAccess') return null;
      const paths = this.accessPaths(access, flow),
        withoutValue = joinFlow(paths.skipped, paths.state === MAYBE_NULL ? paths.evaluated : null),
        constant = boolConstant(node.right);
      let fallback;
      if (constant === null) fallback = this.condition(node.right, withoutValue);
      else fallback = constant ? { whenTrue: withoutValue, whenFalse: null } : { whenTrue: null, whenFalse: withoutValue };
      return { whenTrue: joinFlow(paths.evaluated, fallback.whenTrue), whenFalse: joinFlow(paths.evaluated, fallback.whenFalse) };
    }
  };
