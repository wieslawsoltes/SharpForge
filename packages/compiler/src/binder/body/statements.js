/**
 * Statement dispatch: blocks and scopes, control flow, labels and reachability (`completes`), which drives
 * CS0162 (unreachable code), CS0161 (not all paths return), CS0163 and CS8070 (switch fall-through).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { reportYieldInLambda } from '../iterators.js';
import { reportAwaitOutsideAsync } from '../async.js';
import { ErrorTypeSymbol } from '../../symbols/types.js';

const unknown = ErrorTypeSymbol.unknown;
const statementExpressionKinds = new Set([
  'InvocationExpression',
  'ObjectCreationExpression',
  'ImplicitObjectCreationExpression',
  'PreIncrementExpression',
  'PreDecrementExpression',
  'PostIncrementExpression',
  'PostDecrementExpression',
  'AwaitExpression',
  'ConditionalAccessExpression',
]);
const stmt = (kind, syntax, completes, props) => ({ kind, syntax, completes, ...props });
/** True when a statement is, or contains, a labeled statement (lambdas and local functions have labels of their own). */
function containsLabel(syntax) {
  if (syntax.kind === 'LabeledStatement') return true;
  if (/LambdaExpression$|^AnonymousMethodExpression$|^LocalFunctionStatement$/.test(syntax.kind)) return false;
  for (const child of syntax.childNodes?.() ?? []) if (containsLabel(child)) return true;
  return false;
}

/** Class mixin: Statement dispatch: blocks and scopes, control flow, labels and reachability (`completes`), which drives */
export const StatementBinding = Base =>
  class extends Base {
    isStatementExpression(syntax) {
      while (syntax.kind === 'ParenthesizedExpression') return false;
      return statementExpressionKinds.has(syntax.kind) || syntax.kind.endsWith('AssignmentExpression');
    }
    /** The names of the locals a statement list declares: reserved in the whole list, before and after the declaration. */
    namesDeclaredIn(statements) {
      const names = [];
      for (const s of statements)
        if (s.kind === 'LocalDeclarationStatement') for (const v of s.declaration.variables) names.push(v.identifier.valueText);
      return names;
    }
    /** Binds a block with its own scope. Local functions and labels are visible in the whole block. */
    block(syntax, { statements = syntax.statements, scoped = true } = {}) {
      const pending = this.namesDeclaredIn(statements);
      if (scoped) this.pushScope(pending);
      else for (const n of pending) this.pending.at(-1).add(n);
      this.enterLabels(statements, scoped);
      try {
        for (const s of statements) if (s.kind === 'LocalFunctionStatement') this.declareLocalFunction(s);
        const bound = [];
        let reachable = true,
          warned = false;
        for (const s of statements) {
          if (!reachable && s.kind !== 'LocalFunctionStatement') {
            // A label may be the target of a goto: what follows it (or a statement that holds one) is taken as
            // reachable, and the next unreachable run gets a warning of its own.
            if (containsLabel(s)) {
              reachable = true;
              warned = false;
            } else if (!warned) {
              this.report(s.firstToken() ?? s, DiagnosticId.CS0162);
              warned = true;
            }
          }
          const b = this.statement(s);
          bound.push(b);
          if (s.kind !== 'LocalFunctionStatement' && reachable) reachable = b.completes !== false;
        }
        return stmt('Block', syntax, reachable, { statements: bound });
      } finally {
        this.leaveLabels(scoped);
        if (scoped) this.popScope();
      }
    }
    /** A statement in an embedded position (the body of if/while/...): declarations are not allowed there (CS1023). */
    embedded(syntax) {
      if (syntax.kind === 'LocalDeclarationStatement' || syntax.kind === 'LocalFunctionStatement' || syntax.kind === 'LabeledStatement') {
        this.report(syntax, DiagnosticId.CS1023);
        this.pushScope();
        try {
          return this.statement(syntax);
        } finally {
          this.popScope();
        }
      }
      if (
        syntax.kind === 'EmptyStatement' &&
        ['IfStatement', 'ElseClause', 'WhileStatement', 'ForStatement', 'ForEachStatement', 'LockStatement', 'UsingStatement'].includes(
          syntax.parent?.kind,
        )
      )
        this.report(syntax, DiagnosticId.CS0642);
      if (syntax.kind === 'Block') return this.block(syntax);
      this.pushScope();
      try {
        return this.statement(syntax);
      } finally {
        this.popScope();
      }
    }
    statement(syntax) {
      switch (syntax.kind) {
        case 'Block':
          return this.block(syntax);
        case 'EmptyStatement':
          return stmt('Empty', syntax, true);
        case 'ExpressionStatement': {
          const e = this.expression(syntax.expression);
          let value = e;
          if (e.kind === 'TypeExpression' || e.kind === 'NamespaceExpression') {
            value = this.asValue(e);
          } else if (e.kind === 'MethodGroup' && !e.hasErrors) {
            this.report(syntax.expression, DiagnosticId.CS0201);
            value = this.bad(syntax.expression);
          } else if (!e.hasErrors && !this.isStatementExpression(syntax.expression)) this.report(syntax.expression, DiagnosticId.CS0201);
          if (
            e.kind === 'Call' &&
            !this.c.suppressUnawaited &&
            this.c.isAsync &&
            e.type &&
            (e.type.equals(this.core.task) || e.type.originalDefinition === this.core.taskT)
          )
            this.report(syntax.expression, DiagnosticId.CS4014);
          return stmt('ExpressionStatement', syntax, !(e.form === 'throw'), { expression: value });
        }
        case 'LocalDeclarationStatement':
          return this.localDeclaration(syntax);
        case 'LocalFunctionStatement':
          return this.localFunction(syntax);
        case 'IfStatement': {
          const condition = this.condition(syntax.condition),
            constant = condition.constantValue?.type === 'bool' ? condition.constantValue.value : null;
          const then = this.embedded(syntax.statement),
            otherwise = syntax.else ? this.embedded(syntax.else.statement) : null;
          if (constant === false && !this.usesGoto && !this.hasLabels) this.unreachable(syntax.statement);
          if (constant === true && syntax.else && !this.usesGoto && !this.hasLabels) this.unreachable(syntax.else.statement);
          const completes =
            constant === true
              ? then.completes
              : constant === false
                ? otherwise
                  ? otherwise.completes
                  : true
                : then.completes || (otherwise ? otherwise.completes : true);
          return stmt('If', syntax, completes, { condition, then, otherwise });
        }
        case 'WhileStatement': {
          const condition = this.condition(syntax.condition),
            constant = condition.constantValue?.type === 'bool' ? condition.constantValue.value : null,
            loop = this.enterLoop();
          const body = this.embedded(syntax.statement);
          this.exitLoop();
          if (constant === false && !this.usesGoto && !this.hasLabels) this.unreachable(syntax.statement);
          return stmt('While', syntax, constant === true ? loop.hasBreak : true, { condition, body });
        }
        case 'DoStatement': {
          const loop = this.enterLoop(),
            body = this.embedded(syntax.statement);
          this.exitLoop();
          const condition = this.condition(syntax.condition),
            constant = condition.constantValue?.type === 'bool' ? condition.constantValue.value : null;
          return stmt('Do', syntax, loop.hasBreak || (constant !== true && (body.completes || loop.hasContinue)), { condition, body });
        }
        case 'ForStatement': {
          this.pushScope();
          try {
            const declaration = syntax.declaration ? this.variableDeclaration(syntax.declaration, {}) : null,
              initializers = syntax.initializers.map(e => this.statementExpression(e));
            const condition = syntax.condition ? this.condition(syntax.condition) : null,
              constant = !condition ? true : condition.constantValue?.type === 'bool' ? condition.constantValue.value : null;
            const incrementors = syntax.incrementors.map(e => this.statementExpression(e)),
              loop = this.enterLoop(),
              body = this.embedded(syntax.statement);
            this.exitLoop();
            if (constant === false && !this.usesGoto) this.unreachable(syntax.statement);
            return stmt('For', syntax, constant === true ? loop.hasBreak : true, {
              declaration,
              initializers,
              condition,
              incrementors,
              body,
            });
          } finally {
            this.popScope();
          }
        }
        case 'ForEachStatement':
          return this.forEach(syntax);
        case 'ForEachVariableStatement':
          return this.forEach(syntax);
        case 'SwitchStatement':
          return this.switchStatement(syntax);
        case 'ReturnStatement':
          return this.returnStatement(syntax);
        case 'ThrowStatement': {
          if (!syntax.expression) {
            if (!this.catchDepth) this.report(syntax.throwKeyword, DiagnosticId.CS0156);
            else if (this.finallyInCatch) this.report(syntax.throwKeyword, DiagnosticId.CS0724);
            return stmt('Throw', syntax, false, {});
          }
          const e = this.value(syntax.expression);
          this.checkThrown(e, syntax.expression);
          return stmt('Throw', syntax, false, { expression: e });
        }
        case 'BreakStatement': {
          // A jump without a target is an error statement: what follows it stays reachable.
          if (!this.loops?.length) {
            this.report(syntax, DiagnosticId.CS0139);
            return stmt('Break', syntax, true, {});
          }
          const target = this.loops.at(-1);
          target.hasBreak = true;
          if (this.finallyDepth > target.finallyDepth) this.report(syntax.breakKeyword, DiagnosticId.CS0157);
          return stmt('Break', syntax, false, {});
        }
        case 'ContinueStatement': {
          const target = [...(this.loops ?? [])].reverse().find(l => l.isLoop);
          if (!target) {
            this.report(syntax, DiagnosticId.CS0139);
            return stmt('Continue', syntax, true, {});
          }
          target.hasContinue = true;
          if (this.finallyDepth > target.finallyDepth) this.report(syntax.continueKeyword, DiagnosticId.CS0157);
          return stmt('Continue', syntax, false, {});
        }
        case 'GotoStatement':
        case 'GotoCaseStatement':
        case 'GotoDefaultStatement':
          return this.gotoStatement(syntax);
        case 'LabeledStatement': {
          const symbol = this.declaredLabel(syntax),
            inner = this.statement(syntax.statement);
          return stmt('Labeled', syntax, inner.completes, { label: syntax.identifier.valueText, symbol, statement: inner });
        }
        case 'CheckedStatement':
        case 'UncheckedStatement': {
          const saved = [this.checked, this.uncheckedContext];
          this.checked = syntax.kind === 'CheckedStatement';
          this.uncheckedContext = !this.checked;
          try {
            const b = this.block(syntax.block);
            return stmt('Checked', syntax, b.completes, { isChecked: this.checked, block: b });
          } finally {
            [this.checked, this.uncheckedContext] = saved;
          }
        }
        case 'UnsafeStatement': {
          const b = this.block(syntax.block);
          return stmt('Unsafe', syntax, b.completes, { block: b });
        }
        case 'LockStatement': {
          const e = this.value(syntax.expression);
          // A type parameter that is not known to be a value type is accepted, as in Roslyn.
          if (!e.hasErrors && e.type && e.type.isValueType === true) this.report(syntax.expression, DiagnosticId.CS0185, [this.display(e.type)]);
          const body = this.embedded(syntax.statement);
          return stmt('Lock', syntax, body.completes, { expression: e, body });
        }
        case 'UsingStatement': {
          this.pushScope();
          try {
            let resources = null;
            if (syntax.awaitKeyword) reportAwaitOutsideAsync(this, syntax.awaitKeyword);
            if (syntax.declaration)
              resources = this.variableDeclaration(syntax.declaration, { isUsing: true, isAwait: !!syntax.awaitKeyword });
            else if (syntax.expression) {
              const e = this.value(syntax.expression);
              this.checkDisposable(e.type, syntax.expression, !!syntax.awaitKeyword, e);
              resources = e;
            }
            const body = this.embedded(syntax.statement);
            return stmt('Using', syntax, body.completes, { resources, body, isAwait: !!syntax.awaitKeyword });
          } finally {
            this.popScope();
          }
        }
        case 'TryStatement':
          return this.tryStatement(syntax);
        case 'YieldReturnStatement':
        case 'YieldBreakStatement': {
          // A yield in a lambda is an error (CS1621, binder/iterators.js) and does not make the method an iterator.
          if (this.c.isLambda) reportYieldInLambda(this, syntax);
          else {
            this.c.isIterator = true;
            this.rootBinder.isIterator = true;
          }
          if (syntax.kind === 'YieldBreakStatement') return stmt('YieldBreak', syntax, false, {});
          const element = this.iteratorElementType(),
            e = this.value(syntax.expression);
          const yielded = element ? this.convert(e, element, syntax.expression) : e;
          if (element && e.form === 'lambda' && !yielded.hasErrors) this.finishLambda(e, element);
          return stmt('YieldReturn', syntax, true, { expression: yielded });
        }
        case 'FixedStatement': {
          this.pushScope();
          try {
            const d = this.variableDeclaration(syntax.declaration, { isFixed: true });
            const body = this.embedded(syntax.statement);
            return stmt('Fixed', syntax, body.completes, { declaration: d, body });
          } finally {
            this.popScope();
          }
        }
        default:
          this.incomplete = this.d.incomplete = true;
          return stmt('Bad', syntax, true, {});
      }
    }
    unreachable(statement) {
      const first = statement.kind === 'Block' ? statement.statements[0] : statement;
      if (first) this.report(first.firstToken() ?? first, DiagnosticId.CS0162);
    }
    enterLoop(isLoop = true) {
      this.loops ??= [];
      const l = { isLoop, hasBreak: false, hasContinue: false, finallyDepth: this.finallyDepth };
      this.loops.push(l);
      if (isLoop) this.loopDepth++;
      else this.switchDepth++;
      return l;
    }
    exitLoop() {
      const l = this.loops.pop();
      if (l.isLoop) this.loopDepth--;
      else this.switchDepth--;
      return l;
    }
    statementExpression(syntax) {
      const e = this.expression(syntax);
      if (e.kind === 'TypeExpression') return this.asValue(e);
      if (!e.hasErrors && !this.isStatementExpression(syntax)) this.report(syntax, DiagnosticId.CS0201);
      return e;
    }
  };
