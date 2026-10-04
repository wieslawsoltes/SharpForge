/**
 * Region queries of the semantic model over the semantic analysis (SF-A02-T38): the data-flow and control-flow facts
 * a refactoring asks about a span of a method body ("extract method": what flows in, what flows out, where control
 * leaves).
 *
 * The facts are computed from the bound tree of the body. They are flow-insensitive: a variable "flows in" when the
 * region reads it and it is declared outside, "flows out" when the region writes it and code after the region reads
 * it. That is what Roslyn reports for straight-line code; where paths matter (a write on one branch only) the sets
 * here are the conservative supersets.
 */
import { walk } from '../bound/semantic-walker.js';
import { RefKind } from '../symbols/types.js';
import { spanOf } from './model-index.js';

const jumpKinds = new Set(['Return', 'Break', 'Continue', 'Goto', 'Throw', 'YieldBreak']);
const writeKinds = new Set(['Assignment', 'CompoundAssignment', 'CoalesceAssignment', 'Increment', 'RefAssignment']);
const variableOf = node => (node?.kind === 'Local' ? node.local : node?.kind === 'Parameter' ? node.parameter : null);
const inside = (span, region) => !!span && region.start <= span.start && span.end <= region.end;
const names = set => [...set];

/** Class mixin: analyzeDataFlow and analyzeControlFlow. */
export const RegionQueries = Base =>
  class extends Base {
    /**
     * Data-flow facts of the code between two positions of a method body.
     * @returns {null|{variablesDeclared, readInside, writtenInside, readOutside, writtenOutside, dataFlowsIn,
     *   dataFlowsOut, captured}} sets of local and parameter symbols as arrays; null outside a bound body
     */
    analyzeDataFlow(start, end, { uri = this.defaultUri } = {}) {
      const entry = this.index.bodyAt(uri, start);
      if (!entry) return null;
      const region = { start, end },
        sets = { readInside: new Set(), writtenInside: new Set(), readOutside: new Set(), writtenOutside: new Set(), readAfter: new Set() },
        declared = new Set(),
        captured = new Set(),
        targets = new Set();
      const write = (node, isInside) => {
        const variable = variableOf(node);
        if (!variable) return;
        targets.add(node);
        (isInside ? sets.writtenInside : sets.writtenOutside).add(variable);
      };
      walk(entry.body, node => {
        const span = spanOf(node.syntax),
          isInside = inside(span, region);
        if (writeKinds.has(node.kind)) write(node.left ?? node.operand ?? node.target, isInside);
        for (const argument of node.args ?? []) if (argument.refKind === RefKind.Out || argument.refKind === RefKind.Ref) write(argument.expression, isInside);
        // `int x = 1;` declares and writes x; `int x;` only declares it. A foreach variable, an `out var` and a
        // pattern variable are written where they are declared.
        const introduced = node.kind === 'Local' ? [] : [{ local: node.local, value: true }, ...(node.declarations ?? [])];
        for (const { local, value } of introduced) {
          if (!local?.syntax) continue;
          const at = spanOf(local.syntax);
          if (inside(at, region)) declared.add(local);
          if (value) (inside(at, region) ? sets.writtenInside : sets.writtenOutside).add(local);
        }
        const variable = variableOf(node);
        if (!variable) return;
        if (variable.isCaptured) captured.add(variable);
        // The target of an assignment is not read by it (compound assignments are added below).
        if (targets.has(node)) return;
        (isInside ? sets.readInside : sets.readOutside).add(variable);
        if (span && span.start >= end) sets.readAfter.add(variable);
      });
      // Targets of `x += 1` and `x++` are read too.
      walk(entry.body, node => {
        if (node.kind !== 'CompoundAssignment' && node.kind !== 'Increment' && node.kind !== 'CoalesceAssignment') return;
        const variable = variableOf(node.left ?? node.operand);
        if (variable) (inside(spanOf(node.syntax), region) ? sets.readInside : sets.readOutside).add(variable);
      });
      for (const parameter of entry.member.parameters ?? []) sets.writtenOutside.add(parameter);
      const flowsIn = names(sets.readInside).filter(variable => !declared.has(variable)),
        flowsOut = names(sets.writtenInside).filter(variable => sets.readAfter.has(variable));
      return {
        variablesDeclared: names(declared),
        readInside: names(sets.readInside),
        writtenInside: names(sets.writtenInside),
        readOutside: names(sets.readOutside),
        writtenOutside: names(sets.writtenOutside),
        dataFlowsIn: flowsIn,
        dataFlowsOut: flowsOut,
        captured: names(captured).filter(variable => sets.readInside.has(variable) || sets.writtenInside.has(variable)),
      };
    }
    /**
     * Control-flow facts of the statements between two positions of a method body.
     * @returns {null|{statements, returnStatements, exitPoints, endPointIsReachable}} bound statements; null outside a body
     */
    analyzeControlFlow(start, end, { uri = this.defaultUri } = {}) {
      const entry = this.index.bodyAt(uri, start);
      if (!entry) return null;
      const region = { start, end },
        statements = [],
        jumps = [];
      walk(entry.body, node => {
        const span = spanOf(node.syntax);
        if (!('completes' in node) || !inside(span, region)) return undefined;
        if (jumpKinds.has(node.kind)) jumps.push(node);
        // The outermost statements of the region; statements nested in them are reached through them.
        if (!statements.some(outer => inside(span, spanOf(outer.syntax)))) statements.push(node);
        return undefined;
      });
      return {
        statements,
        returnStatements: jumps.filter(node => node.kind === 'Return'),
        exitPoints: jumps.filter(node => node.kind !== 'Throw'),
        endPointIsReachable: statements.length === 0 || statements.at(-1).completes !== false,
      };
    }
  };
