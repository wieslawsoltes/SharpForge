/**
 * Definite assignment over the semantic bound tree (SF-A02-T34 for the constructs of SF-A02-E01): locals, out
 * parameters, struct locals assigned field by field, and `this` in struct constructors.
 *   CS0165  use of an unassigned local            CS0170  use of a possibly unassigned field of a struct local
 *   CS0269  read of an out parameter before it is assigned      CS0177  out parameter not assigned on exit
 *   CS0171  struct field not assigned in a constructor (before C# 11; from C# 11 fields are auto-defaulted)
 * The analysis is structural (the bound tree keeps statement structure): a state is the set of definitely assigned
 * variables, `null` stands for unreachable code, branches join by intersection, conditions carry separate
 * when-true / when-false states, and try/finally adds what the finally block assigns. Methods that use goto or
 * labels are skipped: their control flow is not structured.
 */
import { AssignmentAnalyzerCore } from './assignment/analyzer-core.js';
import { AssignmentExpressions } from './assignment/expressions.js';
import { AssignmentStatements } from './assignment/statements.js';

class AssignmentAnalyzer extends AssignmentStatements(AssignmentExpressions(AssignmentAnalyzerCore)) {}

/**
 * @param method the method symbol (null for top-level statements)
 * @param body its bound body (binder/body-binder.js)
 * @param {{ core: object, languageVersion: number, containingType: object|null }} options
 * @returns {{ node: object, code: string, args: any[] }[]}
 */
export function analyzeDefiniteAssignment(method, body, options) {
  if (!body || body.binder?.usesGoto || body.binder?.hasLabelsAnywhere) return [];
  return new AssignmentAnalyzer(method, options).run(body);
}

export { boundChildren } from './assignment/state.js';
