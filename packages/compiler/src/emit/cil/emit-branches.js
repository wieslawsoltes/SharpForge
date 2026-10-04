/**
 * Branches and loops (SF-A02-T30): blocks, `if`, `while`, `do`, `for`, `break`, `continue`, `return`, the
 * conditional and null-coalescing operators.
 *
 * A jump that leaves a protected region is a `leave`, and a `return` inside one stores its value and leaves to the
 * shared return point of the method (ECMA-335 III.3.46: `ret` is not allowed inside a try or handler block).
 */
import { isVoid, isReference } from './type-facts.js';

/** Class mixin: control flow. */
export const BranchEmission = Base =>
  class extends Base {
    stmtBlock(node) {
      for (const statement of node.statements) this.statement(statement);
    }
    stmtEmpty() {}
    stmtExpressionStatement(node) {
      this.effect(node.expression);
    }
    stmtChecked(node) {
      this.statement(node.block ?? node.body);
    }
    stmtUnchecked(node) {
      this.statement(node.block ?? node.body);
    }
    /**
     * Branches to `target` when the condition equals `sense`, else falls through. `!`, `&&` and `||` become branches
     * instead of materialized booleans.
     */
    branchOn(condition, target, sense) {
      const il = this.il,
        constant = condition.constantValue;
      if (constant) {
        if (!!constant.value === sense) il.emit('br', target);
        return;
      }
      if (condition.kind === 'Unary' && condition.operator === '!' && !condition.method && !condition.isLifted) {
        this.branchOn(condition.operand, target, !sense);
        return;
      }
      if (condition.kind === 'IsPattern' && this.branchOnPattern) {
        this.branchOnPattern(condition, target, sense);
        return;
      }
      const isLogical = condition.kind === 'Binary' && !condition.method && (condition.operator === '&&' || condition.operator === '||');
      if (!isLogical) {
        this.expression(condition);
        il.emit(sense ? 'brtrue' : 'brfalse', target);
        return;
      }
      // `a && b` is false as soon as `a` is; `a || b` is true as soon as `a` is.
      const decidedBy = condition.operator === '||';
      if (decidedBy === sense) {
        this.branchOn(condition.left, target, sense);
        this.branchOn(condition.right, target, sense);
      } else {
        const skip = il.newLabel();
        this.branchOn(condition.left, skip, !sense);
        this.branchOn(condition.right, target, sense);
        il.mark(skip);
      }
    }
    stmtIf(node) {
      const il = this.il,
        otherwise = il.newLabel();
      this.branchOn(node.condition, otherwise, false);
      this.statement(node.then);
      if (!node.otherwise) {
        il.mark(otherwise);
        return;
      }
      const end = il.newLabel();
      if (il.isReachable) il.emit('br', end);
      il.mark(otherwise);
      this.statement(node.otherwise);
      il.mark(end);
    }
    /** Runs a loop or switch body with its `break` (and `continue`) targets in scope. */
    withJumpTargets(targets, emitBody) {
      this.jumpTargets.push({ ...targets, protectedDepth: this.protectedDepth });
      try {
        emitBody();
      } finally {
        this.jumpTargets.pop();
      }
    }
    stmtWhile(node) {
      const il = this.il,
        test = il.newLabel(),
        body = il.newLabel(),
        end = il.newLabel();
      il.emit('br', test);
      il.mark(body, 0);
      this.withJumpTargets({ breakLabel: end, continueLabel: test }, () => this.statement(node.body));
      il.mark(test);
      this.branchOn(node.condition, body, true);
      il.mark(end);
    }
    stmtDo(node) {
      const il = this.il,
        body = il.newLabel(),
        test = il.newLabel(),
        end = il.newLabel();
      il.mark(body);
      this.withJumpTargets({ breakLabel: end, continueLabel: test }, () => this.statement(node.body));
      il.mark(test);
      this.branchOn(node.condition, body, true);
      il.mark(end);
    }
    stmtFor(node) {
      const il = this.il,
        test = il.newLabel(),
        body = il.newLabel(),
        step = il.newLabel(),
        end = il.newLabel();
      if (node.declaration) this.stmtLocalDeclaration({ declarations: node.declaration, syntax: node.syntax });
      for (const initializer of node.initializers ?? []) this.effect(initializer);
      il.emit('br', test);
      il.mark(body, 0);
      this.withJumpTargets({ breakLabel: end, continueLabel: step }, () => this.statement(node.body));
      il.mark(step);
      for (const incrementor of node.incrementors ?? []) this.effect(incrementor);
      il.mark(test);
      if (node.condition) this.branchOn(node.condition, body, true);
      else il.emit('br', body);
      il.mark(end);
    }
    /** `br`, or `leave` when the jump crosses the boundary of a protected region. */
    jump(label, protectedDepthAtTarget) {
      this.il.emit(this.protectedDepth > protectedDepthAtTarget ? 'leave' : 'br', label);
    }
    stmtBreak(node) {
      const target = this.jumpTargets.at(-1);
      if (!target) return this.unsupported('break outside a loop or switch', node.syntax);
      return this.jump(target.breakLabel, target.protectedDepth);
    }
    stmtContinue(node) {
      const target = this.jumpTargets.findLast(entry => entry.continueLabel);
      if (!target) return this.unsupported('continue outside a loop', node.syntax);
      return this.jump(target.continueLabel, target.protectedDepth);
    }
    stmtReturn(node) {
      const il = this.il,
        returnsValue = !!node.expression && !isVoid(this.frame.returnType);
      if (node.expression) {
        if (returnsValue) this.expression(node.expression);
        else this.effect(node.expression);
      }
      if (!this.protectedDepth) {
        il.emit('ret', undefined, { pops: returnsValue ? 1 : 0, pushes: 0 });
        return;
      }
      this.returnLabel ??= il.newLabel();
      if (returnsValue) {
        this.returnSlot ??= this.temp(this.frame.returnType);
        il.emit('stloc', this.returnSlot);
      }
      il.emit('leave', this.returnLabel);
    }
    exprConditional(node) {
      const il = this.il,
        otherwise = il.newLabel(),
        end = il.newLabel();
      this.branchOn(node.condition, otherwise, false);
      this.expression(node.whenTrue);
      if (il.isReachable) il.emit('br', end);
      il.mark(otherwise);
      this.expression(node.whenFalse);
      il.mark(end);
    }
    /** `a ?? b` over references: `a` when it is not null, else `b`. */
    exprCoalesce(node) {
      const il = this.il,
        left = node.left;
      if (!left.type || !isReference(left.type) || (node.leftConversion && !node.leftConversion.isIdentity && !node.leftConversion.isReference)) {
        return this.nullableCoalesce(node);
      }
      const end = il.newLabel();
      this.expression(left);
      il.emit('dup').emit('brtrue', end).emit('pop');
      if (node.right.form === 'throw' || node.right.kind === 'Throw') this.throwExpression(node.right);
      else this.expression(node.right);
      il.mark(end);
      return undefined;
    }
    nullableCoalesce(node) {
      return this.unsupported('the null-coalescing operator over nullable value types', node.syntax);
    }
  };
