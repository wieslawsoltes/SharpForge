/** Inline-array references and spans borrow the receiver's storage (C# 12 inline-array specification). */
import { inlineArrayShape } from '../../symbols/inline-arrays.js';
import { variableOf } from './contexts.js';

const viewReceiver = expression => {
  if (expression?.kind === 'InlineArrayConversion') return expression.operand;
  return expression?.kind === 'InlineArraySlice' ? expression.receiver : null;
};

/** Adds receiver lifetime propagation to the existing ref-safety contexts and diagnostic checks. */
export const InlineArrayEscape = Base =>
  class extends Base {
    refSafeContext(expression) {
      const variable = variableOf(expression);
      if (variable?.kind === 'InlineArrayAccess') return this.refSafeContext(variable.receiver);
      return super.refSafeContext(expression);
    }
    safeContext(expression) {
      const receiver = viewReceiver(expression);
      return receiver ? this.refSafeContext(receiver) : super.safeContext(expression);
    }
    iterationRefSafe(collection, loopScope) {
      return inlineArrayShape(collection?.type) ? this.refSafeContext(collection) : super.iterationRefSafe(collection, loopScope);
    }
    refEscapeProblems(expression, escapeTo, node, checkingReceiver = false) {
      const variable = variableOf(expression);
      // An inline access has a synthetic static helper's ref/in argument, not an instance field receiver.
      if (variable?.kind === 'InlineArrayAccess') return this.refEscapeProblems(variable.receiver, escapeTo);
      return super.refEscapeProblems(expression, escapeTo, node, checkingReceiver);
    }
    valueEscapeProblems(expression, escapeTo, node = expression?.syntax) {
      const receiver = viewReceiver(expression);
      return receiver ? this.refEscapeProblems(receiver, escapeTo) : super.valueEscapeProblems(expression, escapeTo, node);
    }
  };
