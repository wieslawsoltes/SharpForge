/**
 * Null-state rules added on top of the core walker (C# 8 nullable reference types, SF-A02-E08):
 *
 *   x ?? y           x is not null where y is not evaluated; `x ?? throw e` leaves x not null
 *   x ??= y          x has the state of y afterwards (it is y's value when x was null)
 *   M(x)             after the call x is not null when the parameter is non-nullable: null would have been reported
 *   throw e          a possibly null thrown value is CS8597, not a dereference
 *   a[i] = null      an element of an array of non-nullable references takes no null (CS8625 / CS8601)
 *   new T[] { null } likewise for the elements of an array initializer (CS8625 / CS8601)
 *   (T)x through an identity or reference conversion still denotes the variable x
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { NOT_NULL, MAYBE_NULL, joinFlow } from './flow-state.js';

const transparentConversions = new Set(['Identity', 'ImplicitReference']);
const isReferenceLike = type => !!type && type.isReferenceType === true;

/** The annotation of the elements of an array type, or null. */
const elementAnnotation = arrayType => arrayType?.elementTypeWithAnnotations?.nullableAnnotation ?? null;

/** Class mixin over the nullable walker core. */
export const NullableRules = Base =>
  class extends Base {
    variableOf(expression) {
      if (expression?.kind === 'Conversion' && transparentConversions.has(expression.conversion?.kind)) return this.variableOf(expression.operand);
      return super.variableOf(expression);
    }
    declaredAnnotation(expression) {
      if (expression.kind === 'ArrayAccess') return elementAnnotation(expression.array?.type);
      return super.declaredAnnotation(expression);
    }
    expression(node, flow) {
      if (!node || typeof node !== 'object' || !flow || node.suppressed) return super.expression(node, flow);
      switch (node.kind) {
        case 'CoalesceAssignment':
          return this.coalesceAssignment(node, flow);
        case 'Coalesce':
          return this.coalesce(node, flow);
        case 'ArrayCreation':
          return this.arrayCreation(node, flow);
        case 'ArrayAccess':
          if (node.array) this.dereference(node.array, flow);
          for (const index of node.indices ?? []) this.expression(index, flow);
          return this.declaredState(node);
        case 'Throw':
          this.thrown(node.operand, flow);
          return NOT_NULL;
        default:
          return super.expression(node, flow);
      }
    }
    statement(node, flow) {
      if (node?.kind === 'Throw' && node.expression && flow) {
        this.thrown(node.expression, flow);
        return null;
      }
      return super.statement(node, flow);
    }
    /** `throw e`: a null operand throws NullReferenceException instead of the exception meant. */
    thrown(operand, flow) {
      const state = this.expression(operand, flow);
      if (state === MAYBE_NULL && !operand.suppressed) this.warn(operand.syntax, DiagnosticId.CS8597);
    }
    /**
     * `x ?? y` tests x for null: where y is evaluated x is null, and where it is not x is not null. After the
     * expression x may be null again - unless y never completes (`x ?? throw e`), which leaves x not null.
     */
    coalesce(node, flow) {
      this.expression(node.left, flow);
      const variable = this.variableOf(node.left),
        whenNull = flow.clone();
      if (variable) {
        whenNull.set(variable, MAYBE_NULL);
        flow.set(variable, NOT_NULL);
      }
      if (node.right.kind === 'Throw') {
        this.thrown(node.right.operand, whenNull);
        return NOT_NULL;
      }
      const state = this.expression(node.right, whenNull);
      this.replace(flow, joinFlow(flow, whenNull));
      return state;
    }
    coalesceAssignment(node, flow) {
      const target = node.left;
      if (target.receiver && target.kind !== 'Local' && target.kind !== 'Parameter') this.dereference(target.receiver, flow);
      this.expression(target, flow);
      const state = this.expression(node.right, flow);
      this.checkAssignment(target, node.right, state);
      const variable = this.variableOf(target);
      if (variable) flow.assign(variable, state);
      return state;
    }
    arrayCreation(node, flow) {
      for (const size of node.sizes ?? []) this.expression(size, flow);
      const target = { kind: 'ArrayAccess', array: { type: node.type }, type: node.type?.elementType };
      for (const element of node.elements ?? []) {
        if (Array.isArray(element)) continue;
        this.checkAssignment(target, element, this.expression(element, flow));
      }
      return NOT_NULL;
    }
    argument(argument, method, flow) {
      const state = super.argument(argument, method, flow);
      const parameter = argument.parameter,
        value = argument.expression ?? argument;
      if (!parameter || (argument.refKind && argument.refKind !== 'none')) return state;
      // A non-nullable parameter either got a non-null argument or the call was reported: the variable is not null now.
      const variable = isReferenceLike(parameter.type) && this.rejectsNull(parameter) ? this.variableOf(value) : null;
      if (variable) flow.set(variable, NOT_NULL);
      return state;
    }
  };
