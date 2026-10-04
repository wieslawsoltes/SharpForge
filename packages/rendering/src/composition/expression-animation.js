import {parseCompositionExpression} from './expression-parser.js';
import {evaluateCompositionExpression} from './expression-evaluator.js';
import {CompositionAnimation} from './animation-definition.js';

export class ExpressionAnimation extends CompositionAnimation {
  constructor(compositor, expression = '') {
    super(compositor, 'ExpressionAnimation');
    this.Expression = expression;
  }
  compile(context = {}) {
    if (this.closed) throw new Error('ExpressionAnimation is disposed');
    const ast = parseCompositionExpression(this.Expression);
    const parameters = {...this.parameters, this: context};
    evaluateCompositionExpression(ast, parameters);
    return {ast, parameters};
  }
  snapshot() { return {base: super.snapshot(), expression: this.Expression}; }
  restore(snapshot) { super.restore(snapshot.base); this.Expression = snapshot.expression; }
}
