/**
 * Exception filters (C# 6, SF-A02-T61): `catch (Exception e) when (condition) { ... }`.
 *
 * .NET evaluates a filter in the first pass of exception handling: before any finally block between the throw and the
 * catch has run, and while the stack of the throw is still there. The runtime has one pass: it unwinds to the
 * innermost handler, running finally blocks on the way, and has no filter handler. A filter can therefore only be
 * evaluated inside the catch block:
 *
 *   catch (Exception e) { if (c1) { body1 } else if (c2) { body2 } else throw; }
 *
 * That is the same program only when nothing can tell *when* the filter ran. A filter is generated this way when it
 *   - has no side effect and cannot throw (.NET swallows an exception thrown by a filter and takes it as false):
 *     constants, comparisons, `!`, `&&`, `||`, `+ - *` unchecked, the exception variable and its `Message`,
 *     locals and value parameters of the enclosing function; no call, no division, no member of another object;
 *   - reads only locals that no finally block inside the try statement assigns and no lambda captures (a finally
 *     block runs between the two moments, and a captured variable can be changed by code the filter cannot see).
 * A rejected filter (`throw;`) continues the search outwards as an exception that passes a filter does.
 * Every other filter is SF2200 naming the missing capability; nothing is emitted for the program.
 */
import { n } from '../codegen/semantic/node-factory.js';
import { walk } from '../bound/semantic-walker.js';
import { RefKind } from '../symbols/types.js';

const pureOperators = new Set(['==', '!=', '<', '<=', '>', '>=', '&&', '||', '+', '-', '*', '&', '|', '^']);
const writes = new Set(['Assignment', 'CompoundAssignment', 'Increment', 'CoalesceAssignment', 'RefAssignment']);
const UNSUPPORTED =
  'an exception filter that calls code, can throw, or reads a variable a finally block or a lambda may change ' +
  '(the runtime has no filter handlers: a filter must run before the finally blocks between the throw and the catch)';

/** The local or parameter symbol a bound node reads or writes, or null. */
const variableOf = node => (node?.kind === 'Local' ? node.local : node?.kind === 'Parameter' ? node.parameter : null);

/** The locals and parameters assigned inside a finally block of `body` (nested lambdas excluded: captures are refused anyway). */
function assignedInFinally(body) {
  const assigned = new Set();
  const visit = (node, inFinally) => {
    walk(node, current => {
      if (current.kind === 'Lambda') return false;
      if (current.kind === 'Try' && current !== node) {
        visit(current.body, inFinally);
        for (const clause of current.catches ?? []) visit(clause.block, inFinally);
        if (current.finallyBlock) visit(current.finallyBlock, true);
        return false;
      }
      if (!inFinally) return true;
      if (writes.has(current.kind)) assigned.add(variableOf(current.left ?? current.operand));
      for (const argument of current.args ?? []) if (argument.refKind && argument.refKind !== RefKind.None) assigned.add(variableOf(argument.expression));
      return true;
    });
  };
  // `walk` enters the node itself first: a wrapper keeps the outer try from being treated as a nested one.
  visit({ kind: 'Block', statements: [body] }, false);
  assigned.delete(null);
  return assigned;
}

/** True when evaluating `filter` later, inside the catch block, cannot be told apart from evaluating it as a filter. */
export function isTimingIndependentFilter(filter, { exceptionLocal, unstable, isCaptured }) {
  const check = node => {
    if (!node || node.hasErrors) return false;
    if (node.constantValue) return true;
    switch (node.kind) {
      case 'Literal':
        return true;
      case 'Local':
      case 'Parameter': {
        const symbol = variableOf(node);
        if (symbol === exceptionLocal) return true;
        const isByReference = symbol.refKind && symbol.refKind !== RefKind.None;
        return !isByReference && !unstable.has(symbol) && !isCaptured(symbol);
      }
      case 'Unary':
        return !node.method && !node.isLifted && !node.isChecked && ['!', '-', '+', '~'].includes(node.operator) && check(node.operand);
      case 'Binary':
        return !node.method && !node.isLifted && !node.isChecked && pureOperators.has(node.operator) && check(node.left) && check(node.right);
      case 'Conversion':
        return ['Identity', 'ImplicitNumeric', 'ImplicitReference', 'ImplicitConstant', 'NullLiteral'].includes(node.conversion?.kind) && check(node.operand);
      case 'PropertyAccess':
        // `e.Message` of the caught exception: set when the exception is created.
        return node.property?.name === 'Message' && variableOf(node.receiver) === exceptionLocal && !!exceptionLocal;
      default:
        return false;
    }
  };
  return check(filter);
}

/** Class mixin for the body translator: try statements with filtered catch clauses. */
export const ExceptionFilterLowering = Base =>
  class extends Base {
    stmtTry(node) {
      if (!node.catches.some(clause => clause.filter)) return super.stmtTry(node);
      const exception = this.g.analysis.core.exception,
        unstable = assignedInFinally(node.body),
        isCaptured = symbol => this.frame.captures.isCaptured(symbol);
      for (const clause of node.catches) {
        if (!clause.type.equals(exception))
          return this.unsupported(`a catch clause for '${clause.type.toDisplayString()}' (the runtime catches System.Exception only)`, clause.syntax);
        if (clause.local && isCaptured(clause.local)) return this.unsupported('a captured catch variable', node.syntax);
        const context = { exceptionLocal: clause.local ?? null, unstable, isCaptured };
        if (clause.filter && !isTimingIndependentFilter(clause.filter, context)) return this.unsupported(UNSUPPORTED, clause.filter.syntax);
      }
      // One handler: every clause sees the caught exception through its own variable.
      // (The CIL back end wants a distinct name for the variable of each handler of a method.)
      const root = this.frame.root,
        caught = n.newLocal('$exception' + (root.filteredHandlers = (root.filteredHandlers ?? 0) + 1), 'Exception');
      const handler = this.scoped(() => {
        for (const clause of node.catches) if (clause.local) this.frame.vars.set(clause.local, () => n.local(caught));
        let chain = n.throwStatement(null);
        for (const clause of [...node.catches].reverse()) {
          const body = this.statement(clause.block);
          chain = clause.filter ? n.ifStatement(this.expression(clause.filter), body, chain) : body;
        }
        return n.block([chain]);
      });
      handler.syntax = this.span(node.catches[0].block.syntax);
      const catches = [{ kind: 'CatchBlock', exceptionType: null, local: caught, body: handler }];
      return n.tryStatement(this.statement(node.body), catches, node.finallyBlock ? this.statement(node.finallyBlock) : null, this.span(node.syntax));
    }
  };
