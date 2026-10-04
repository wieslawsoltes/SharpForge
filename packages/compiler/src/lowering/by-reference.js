/**
 * `ref`, `out` and `in` parameters of source methods (the lowering half of SF-A02-T04.2; needed by `Deconstruct`
 * methods, SF-A02-T08.5).
 *
 * The runtime has no managed pointers. A by-reference parameter is lowered to a parameter that holds a heap cell -
 * the cell class closures already use for captured variables - and the variable an argument names lives in such a
 * cell from its declaration on, exactly as if a lambda had captured it. Caller and callee then share one storage
 * location, so every by-reference effect is visible when C# makes it visible: assignments before an exception,
 * aliasing between two arguments, reads through a closure during the call.
 *
 * Only variables can be shared this way. A field or an array element passed with `ref` or `out` would need a
 * pointer into the object and is reported as not executable; passed as `in` its value is copied, which differs from
 * C# only if the callee changes that same field while it runs.
 */
import { walk } from '../bound/semantic-walker.js';
import { n } from '../codegen/semantic/node-factory.js';
import { lowered } from './tuples/translate-tuples.js';

const none = 'none';

/** True for a parameter (or argument entry) passed by reference. */
export const isByReference = entry => !!entry?.refKind && entry.refKind !== none;

/** The variable symbol an argument expression names, or null. */
function variableOf(expression) {
  switch (expression?.kind) {
    case 'Local':
    case 'DeclarationExpression':
      return expression.local ?? null;
    case 'Parameter':
      return expression.parameter;
    default:
      return null;
  }
}

/**
 * Adds to a capture analysis every local and by-value parameter that is passed by reference somewhere in `body`
 * (including its lambdas and local functions): such a variable lives in a cell.
 * @param {object} body a bound body  @param analysis the CaptureAnalysis of that body (`captured`: Set of symbols)
 */
export function markVariablesPassedByReference(body, analysis) {
  walk(body, node => {
    if (node.kind === 'LocalFunction' && node.method?.body) markVariablesPassedByReference(node.method.body, analysis);
    for (const argument of Array.isArray(node.args) ? node.args : []) {
      if (!isByReference(argument)) continue;
      const variable = variableOf(argument.expression);
      // A by-reference parameter passed on is already a cell.
      if (variable && !isByReference(variable)) analysis.captured.add(variable);
    }
    return true;
  });
}

/** Class mixin: by-reference parameters and arguments. */
export const ByReferenceTranslation = Base =>
  class extends Base {
    /** A by-reference parameter holds a cell; the variable it stands for is the cell's value. */
    declareParameters(parameters, firstOrdinal = 0) {
      const prologue = super.declareParameters(parameters, firstOrdinal);
      parameters.forEach((symbol, index) => {
        if (!isByReference(symbol)) return;
        const cell = this.g.cellClass(this.imageType(symbol.type, symbol.syntax)),
          slot = n.newParameter(symbol.name, cell.record.name, firstOrdinal + index);
        this.frame.cells.set(symbol, () => n.parameter(slot));
        this.frame.vars.set(symbol, () => n.field(n.parameter(slot), cell.value));
      });
      return prologue;
    }
    arguments(node, method) {
      const args = node.args ?? [],
        parameters = method?.parameters ?? [];
      if (!args.some(isByReference) && !parameters.some(isByReference)) return super.arguments(node, method);
      if (!method || (!this.g.isSource(method.originalDefinition ?? method) && !method.contract))
        return this.unsupported('ref, out and in arguments of framework methods', node.syntax);
      const positions = node.mapping?.parameterOf,
        covered = new Set();
      const cells = args.map((argument, index) => {
        const parameter = parameters[positions ? positions[index] : index];
        covered.add(parameter);
        if (!isByReference(parameter)) return argument;
        const cell = this.cellArgument(argument, parameter);
        return { ...argument, refKind: none, expression: lowered(cell, parameter.type, argument.expression.syntax) };
      });
      if (parameters.some(parameter => isByReference(parameter) && !covered.has(parameter)))
        return this.unsupported('an omitted by-reference argument', node.syntax);
      return super.arguments({ ...node, args: cells }, method);
    }
    /** The cell passed for one by-reference parameter. */
    cellArgument(argument, parameter) {
      const expression = argument.expression,
        cell = this.g.cellClass(this.imageType(parameter.type, expression.syntax));
      if (expression.kind === 'Discard') return n.allocate(cell.record);
      const variable = variableOf(expression);
      if (variable) {
        if (expression.kind === 'DeclarationExpression') this.declarePending(variable);
        const held = this.frame.cells.get(variable);
        if (held) return held();
      }
      if (parameter.refKind !== 'in') return this.unsupported('passing a field or an array element by reference', expression.syntax);
      // `in`: the callee only reads, so it gets a cell holding a copy of the value.
      const temp = this.temp(cell.record.name, 'in');
      const fill = [n.assign(n.local(temp), n.allocate(cell.record)), n.assign(n.field(n.local(temp), cell.value), this.expression(expression))];
      return n.sequence([temp], fill, n.local(temp));
    }
  };
