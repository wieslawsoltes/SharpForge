import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * Labeled `break` and `continue` (SF-A02-T93). PROVISIONAL: a C# 15 preview feature, bound as the pinned proposal
 * revision says (csharplang proposals/csharp-15.0/labeled-break-continue.md, revision 1 in
 * packages/syntax/src/preview-revisions.js). The pinned Roslyn does not implement it, so there are no Roslyn
 * fixtures: behaviour and diagnostics follow the proposal text, nothing else. The parser gates the syntax (CS8652
 * unless LangVersion is preview).
 *
 * The proposal:
 *   - a switch or iteration statement immediately nested in a labeled statement is "labeled with" its identifier
 *     (in `a: b: while`, only `b` labels the loop);
 *   - `break L;` exits the nearest enclosing switch or iteration statement labeled with `L`;
 *   - `continue L;` starts a new iteration of the nearest enclosing iteration statement labeled with `L`;
 *   - "if no such enclosing statement exists, a compile-time error occurs": reported as CS0139, the existing
 *     diagnostic for a break or continue without a target;
 *   - a jump cannot leave a `finally` block: CS0157, as for the unlabeled forms.
 * A lambda or local function body has no enclosing statement of the method around it, so a jump out of it is CS0139.
 *
 * Lowering needs nothing new. The jump is bound as a `Goto` to a synthesized label: `break L` to a label placed
 * after the labeled statement, `continue L` to a label placed at the end of the loop body (where the condition or
 * the for-iterator runs next). The existing goto lowering runs the finally blocks such a jump leaves.
 */
/**
 * The string-typed profile (binder/statements.js and modern.js) binds the same feature over its own tree, where a
 * labeled statement is `{kind: 'Labeled', label, body}`. It supports jumps to a loop or switch that is labeled
 * directly, and nothing else of labeled statements: any other labeled statement is SF2142, which hands the program
 * to the semantic pipeline above. This is the one place that rule lives. The profile lets every label of `a: b: while`
 * name the loop; the proposal's "immediately nested" rule (only `b` does) is enforced for such programs by the
 * semantic binder, whose CS0139 and CS0157 are taken for programs the profile compiles (semantic/profile-rechecks.js).
 * @param node a `Labeled` statement  @param {{labels?: string[]}[]} loops the enclosing loops and switches
 * @param {(node: object, code: string, args?: any[]) => void} report
 * @returns {object} the statement under the labels, carrying them as `labels`
 */
export function directlyLabeledStatement(node, loops, report) {
  const labels = [];
  let body = node;
  while (body.kind === 'Labeled') {
    // CS0140: the label is declared twice, here or on an enclosing loop.
    if (labels.includes(body.label) || loops.some(loop => loop.labels?.includes(body.label))) report(body, DiagnosticId.CS0140, [body.label]);
    labels.push(body.label);
    body = body.body;
  }
  if (!profileTargetKinds.has(body.kind)) report(node, DiagnosticId.SF2142);
  return { ...body, labels };
}
const profileTargetKinds = new Set(['While', 'Do', 'For', 'Foreach', 'Switch']);

const targetKinds = new Set(['WhileStatement', 'DoStatement', 'ForStatement', 'ForEachStatement', 'ForEachVariableStatement', 'SwitchStatement']);

const empty = syntax => ({ kind: 'Empty', syntax, completes: true });
const mark = (syntax, symbol) => ({ kind: 'Labeled', syntax, completes: true, label: symbol.name, symbol, statement: empty(syntax) });
const block = (syntax, completes, statements) => ({ kind: 'Block', syntax, completes, statements });

/** Binder mixin: labeled break and continue. */
export const LabeledJumpBinding = Base =>
  class extends Base {
    statement(syntax) {
      if (syntax.kind === 'LabeledStatement' && targetKinds.has(syntax.statement.kind)) return this.labeledTarget(syntax);
      if ((syntax.kind === 'BreakStatement' || syntax.kind === 'ContinueStatement') && syntax.label) return this.labeledJump(syntax);
      return super.statement(syntax);
    }
    /** A switch or loop labeled with an identifier: the jumps to it are collected while its body is bound. */
    labeledTarget(syntax) {
      const name = syntax.identifier.valueText,
        target = {
          name,
          isLoop: syntax.statement.kind !== 'SwitchStatement',
          finallyDepth: this.finallyDepth,
          breakLabel: { name: `<break>${name}` },
          continueLabel: { name: `<continue>${name}` },
          breaks: 0,
          continues: 0,
        };
      (this.labeledTargets ??= []).push(target);
      let labeled;
      try {
        labeled = super.statement(syntax);
      } finally {
        this.labeledTargets.pop();
      }
      if (!target.breaks && !target.continues) return labeled;
      // The label is referenced by the jumps (no CS0164 for it).
      if (labeled.symbol) labeled.symbol.uses++;
      const loop = labeled.statement;
      if (target.continues && loop.body)
        loop.body = block(loop.body.syntax, true, [loop.body, mark(loop.body.syntax, target.continueLabel)]);
      if (!target.breaks) return labeled;
      return block(syntax, true, [labeled, mark(syntax, target.breakLabel)]);
    }
    labeledJump(syntax) {
      const isContinue = syntax.kind === 'ContinueStatement',
        name = syntax.label.valueText,
        target = [...(this.labeledTargets ?? [])].reverse().find(candidate => candidate.name === name && (!isContinue || candidate.isLoop));
      if (!target) {
        this.report(syntax, DiagnosticId.CS0139);
        // A jump without a target is an error statement: what follows it stays reachable.
        return { kind: isContinue ? 'Continue' : 'Break', syntax, completes: true };
      }
      if (this.finallyDepth > target.finallyDepth) this.report(isContinue ? syntax.continueKeyword : syntax.breakKeyword, DiagnosticId.CS0157);
      if (isContinue) target.continues++;
      else target.breaks++;
      this.usesGoto = true;
      this.rootBinder.usesGoto = true;
      return { kind: 'Goto', syntax, completes: false, label: isContinue ? target.continueLabel : target.breakLabel };
    }
  };
