/**
 * Labels and `goto` (SF-A02-T30): labeled statements, `goto label`, `goto case` and `goto default`, and the using
 * declarations of a block, whose scope is the rest of the block.
 */

/** Class mixin: labels, goto and block-scoped resources. */
export const JumpEmission = Base =>
  class extends Base {
    /** The IL label of a source label (or of the synthesized target of a labeled `break` / `continue`). */
    labelOf(symbol) {
      this.sourceLabels ??= new Map();
      let label = this.sourceLabels.get(symbol);
      if (!label) {
        label = this.il.newLabel();
        this.sourceLabels.set(symbol, label);
      }
      return label;
    }
    stmtLabeled(node) {
      // A source label may be reached by a `goto` that comes later in the stream.
      this.il.mark(this.labelOf(node.symbol ?? node.label), 0);
      this.statement(node.statement ?? node.body);
    }
    stmtGoto(node) {
      const il = this.il;
      let target;
      if (node.label) target = this.labelOf(node.label);
      else if (node.switchTargets) target = this.switchSections.get(node.switchTargets)?.[node.section]?.label;
      if (!target) return this.unsupported('a goto without a target', node.syntax);
      // `leave` also branches inside a protected region, and it is the only way out of one.
      return il.emit(this.protectedDepth ? 'leave' : 'br', target);
    }
    stmtBlock(node) {
      this.statementsFrom(node.statements, 0);
    }
    /** Emits the statements of a block from `start`; a using declaration protects the statements that follow it. */
    statementsFrom(statements, start) {
      for (let index = start; index < statements.length; index++) {
        const statement = statements[index];
        if (statement.kind === 'LocalDeclaration' && statement.isUsing) return this.usingDeclaration(statement, statements, index + 1);
        this.statement(statement);
      }
      return undefined;
    }
    /** `using var r = e;`: the rest of the block is the body of a using statement over `r`. */
    usingDeclaration(node, statements, next) {
      const resources = node.declarations.map(declarator => {
        this.declare(declarator.local, declarator.value);
        return { slot: this.resourceSlot(declarator.local), type: declarator.local.type };
      });
      return this.disposeAround(resources, () => this.statementsFrom(statements, next), node);
    }
  };
