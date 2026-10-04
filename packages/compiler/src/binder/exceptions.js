/**
 * Exception handling (SF-A02-T44): try statements with catch clauses of any exception type and finally blocks.
 *
 *   - The caught type derives from System.Exception or is a type parameter constrained to one (CS0155).
 *   - Clauses are tried in order, so a clause is an error when an earlier one without a filter already catches its
 *     type or a base of it (CS0160). After a general `catch { }` no clause may follow (CS1017); a general clause after
 *     `catch (Exception)` is only a warning, because it still catches what other languages throw (CS1058).
 *   - `throw;` rethrows the exception of the nearest enclosing catch clause; the binder counts the clauses and the
 *     finally blocks it is in (`catchDepth`, `finallyInCatch`) and the throw statement reports CS0156 and CS0724.
 *   - No jump leaves a finally block (`finallyDepth`, CS0157 at the jump).
 *
 * The bound node is `Try { body, catches: [{ type, local, filter, block }], finallyBlock }`; a clause without a
 * declaration has the type System.Exception and `isGeneral`; a clause's `syntax` is what a diagnostic about it points at.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, ErrorTypeSymbol } from '../symbols/types.js';
import { LocalDeclarationKind } from '../symbols/members.js';

const unknown = ErrorTypeSymbol.unknown;

/** Class mixin: try statements. */
export const ExceptionBinding = Base =>
  class extends Base {
    tryStatement(syntax) {
      const body = this.block(syntax.block),
        catches = [],
        order = { caught: [], general: false };
      let completes = body.completes;
      for (const clause of syntax.catches) {
        this.pushScope();
        try {
          const bound = this.catchClause(clause, order);
          if (bound.block.completes) completes = true;
          catches.push(bound);
        } finally {
          this.popScope();
        }
      }
      let finallyBlock = null;
      if (syntax.finally) {
        this.finallyDepth++;
        const saved = this.finallyInCatch;
        this.finallyInCatch = this.catchDepth > 0;
        finallyBlock = this.block(syntax.finally.block);
        this.finallyInCatch = saved;
        this.finallyDepth--;
        if (!finallyBlock.completes) completes = false;
      }
      return { kind: 'Try', syntax, completes, body, catches, finallyBlock };
    }
    /** Binds one catch clause in its own scope; `order` records what the clauses before it catch. */
    catchClause(clause, order) {
      const declaration = clause.declaration,
        type = declaration ? this.caughtType(declaration.type) : this.core.exception,
        local = declaration?.identifier ? this.catchVariable(declaration.identifier, type) : null,
        filter = clause.filter ? this.condition(clause.filter.filterExpression) : null;
      this.checkCatchOrder(clause, type, order);
      if (!filter && !type.isErrorType()) {
        order.caught.push(type);
        if (!declaration) order.general = true;
      }
      this.catchDepth++;
      const savedFinally = this.finallyInCatch;
      this.finallyInCatch = false;
      const block = this.block(clause.block);
      this.finallyInCatch = savedFinally;
      this.catchDepth--;
      return { type, local, filter, block, isGeneral: !declaration, syntax: declaration?.type ?? clause.catchKeyword };
    }
    /** The type a catch clause names; an error type after CS0155. */
    caughtType(typeSyntax) {
      const type = this.bindType(typeSyntax).type;
      if (type.isErrorType()) return type;
      const isException =
        type.equals(this.core.exception) ||
        type.typeKind === TypeKind.TypeParameter ||
        this.conversions.classifyImplicit(type, this.core.exception).exists;
      if (isException) return type;
      this.report(typeSyntax, DiagnosticId.CS0155);
      return unknown;
    }
    catchVariable(identifier, type) {
      const local = this.newLocal(identifier.valueText, type, identifier, LocalDeclarationKind.Catch);
      local.writes++;
      local.isCatch = true;
      this.declare(local.name, local, identifier);
      return local;
    }
    checkCatchOrder(clause, type, order) {
      if (order.general) {
        this.report(clause.catchKeyword, DiagnosticId.CS1017);
        return;
      }
      if (type.isErrorType()) return;
      const previous = order.caught.find(earlier => earlier.equals(type) || this.conversions.classifyImplicit(type, earlier).exists);
      if (!previous) return;
      if (clause.declaration) this.report(clause.declaration.type, DiagnosticId.CS0160, [this.display(previous)]);
      else if (!clause.filter) this.report(clause.catchKeyword, DiagnosticId.CS1058);
    }
  };
