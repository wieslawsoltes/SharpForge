/**
 * Statement dispatch: blocks and scopes, control flow, labels and reachability (`completes`), which drives
 * CS0162 (unreachable code), CS0161 (not all paths return), CS0163 and CS8070 (switch fall-through).
 */
import { ErrorTypeSymbol } from '../../symbols/types.js';
import { LabelSymbol } from '../../symbols/members.js';

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

/** Class mixin: Statement dispatch: blocks and scopes, control flow, labels and reachability (`completes`), which drives */
export const StatementBinding = Base =>
  class extends Base {
    isStatementExpression(syntax) {
      while (syntax.kind === 'ParenthesizedExpression') return false;
      return statementExpressionKinds.has(syntax.kind) || syntax.kind.endsWith('AssignmentExpression');
    }
    /** Binds a block with its own scope. Local functions and labels are visible in the whole block. */
    block(syntax, { statements = syntax.statements, scoped = true } = {}) {
      const pending = [];
      for (const s of statements)
        if (s.kind === 'LocalDeclarationStatement') for (const v of s.declaration.variables) pending.push(v.identifier.valueText);
      if (scoped) this.pushScope(pending);
      else for (const n of pending) this.pending.at(-1).add(n);
      try {
        for (const s of statements) if (s.kind === 'LocalFunctionStatement') this.declareLocalFunction(s);
        for (const s of statements) for (let l = s; l.kind === 'LabeledStatement'; l = l.statement) this.declareLabel(l);
        const bound = [];
        let reachable = true,
          warned = false;
        for (const s of statements) {
          if (
            !reachable &&
            !warned &&
            s.kind !== 'LocalFunctionStatement' &&
            s.kind !== 'LabeledStatement' &&
            !this.usesGoto &&
            !this.hasLabels
          ) {
            this.report(s.firstToken() ?? s, 'CS0162');
            warned = true;
          }
          if (s.kind === 'LabeledStatement') reachable = true;
          const b = this.statement(s);
          bound.push(b);
          if (s.kind !== 'LocalFunctionStatement' && reachable) reachable = b.completes !== false;
        }
        return stmt('Block', syntax, reachable, { statements: bound });
      } finally {
        if (scoped) this.popScope();
      }
    }
    /** A statement in an embedded position (the body of if/while/...): declarations are not allowed there (CS1023). */
    embedded(syntax) {
      if (syntax.kind === 'LocalDeclarationStatement' || syntax.kind === 'LocalFunctionStatement' || syntax.kind === 'LabeledStatement') {
        this.report(syntax, 'CS1023');
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
        this.report(syntax, 'CS0642');
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
            this.report(syntax.expression, 'CS0201');
            value = this.bad(syntax.expression);
          } else if (!e.hasErrors && !this.isStatementExpression(syntax.expression)) this.report(syntax.expression, 'CS0201');
          if (
            e.kind === 'Call' &&
            !this.c.suppressUnawaited &&
            this.c.isAsync &&
            e.type &&
            (e.type.equals(this.core.task) || e.type.originalDefinition === this.core.taskT)
          )
            this.report(syntax.expression, 'CS4014');
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
        case 'ForEachVariableStatement': {
          const collection = this.value(syntax.expression);
          this.pushScope();
          try {
            for (const d of this.designationsIn(syntax.variable)) this.designation(d, unknown, {});
            this.incomplete = this.d.incomplete = true;
            const loop = this.enterLoop(),
              body = this.embedded(syntax.statement);
            this.exitLoop();
            return stmt('ForEach', syntax, true, { collection, body, loop });
          } finally {
            this.popScope();
          }
        }
        case 'SwitchStatement':
          return this.switchStatement(syntax);
        case 'ReturnStatement':
          return this.returnStatement(syntax);
        case 'ThrowStatement': {
          if (!syntax.expression) {
            if (!this.catchDepth) this.report(syntax.throwKeyword, 'CS0156');
            else if (this.finallyInCatch) this.report(syntax.throwKeyword, 'CS0724');
            return stmt('Throw', syntax, false, {});
          }
          const e = this.value(syntax.expression);
          this.checkThrown(e, syntax.expression);
          return stmt('Throw', syntax, false, { expression: e });
        }
        case 'BreakStatement': {
          if (!this.loops?.length) {
            this.report(syntax, 'CS0139');
            return stmt('Break', syntax, false, {});
          }
          const target = this.loops.at(-1);
          target.hasBreak = true;
          if (this.finallyDepth > target.finallyDepth) this.report(syntax, 'CS0157');
          return stmt('Break', syntax, false, {});
        }
        case 'ContinueStatement': {
          const target = [...(this.loops ?? [])].reverse().find(l => l.isLoop);
          if (!target) {
            this.report(syntax, 'CS0139');
            return stmt('Continue', syntax, false, {});
          }
          target.hasContinue = true;
          if (this.finallyDepth > target.finallyDepth) this.report(syntax, 'CS0157');
          return stmt('Continue', syntax, false, {});
        }
        case 'GotoStatement':
        case 'GotoCaseStatement':
        case 'GotoDefaultStatement': {
          this.usesGoto = true;
          this.rootBinder.usesGoto = true;
          if (syntax.kind === 'GotoStatement' && syntax.expression?.kind === 'IdentifierName') {
            const name = syntax.expression.identifier.valueText,
              label = this.findLabel(name);
            if (!label) this.report(syntax.expression, 'CS0159', [name]);
            else label.uses++;
          } else if (syntax.kind !== 'GotoStatement') {
            if (!this.switchDepth) this.report(syntax, 'CS0153');
            else {
              const sw = [...this.loops].reverse().find(l => !l.isLoop);
              if (sw) sw.hasGotoCase = true;
              if (syntax.expression) this.value(syntax.expression);
            }
          }
          return stmt('Goto', syntax, false, {});
        }
        case 'LabeledStatement': {
          const inner = this.statement(syntax.statement);
          return stmt('Labeled', syntax, inner.completes, { label: syntax.identifier.valueText, statement: inner });
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
          if (!e.hasErrors && e.type && e.type.isReferenceType !== true) this.report(syntax.expression, 'CS0185', [this.display(e.type)]);
          const body = this.embedded(syntax.statement);
          return stmt('Lock', syntax, body.completes, { expression: e, body });
        }
        case 'UsingStatement': {
          this.pushScope();
          try {
            let resources = null;
            if (syntax.declaration)
              resources = this.variableDeclaration(syntax.declaration, { isUsing: true, isAwait: !!syntax.awaitKeyword });
            else if (syntax.expression) {
              const e = this.value(syntax.expression);
              this.checkDisposable(e.type, syntax.expression, !!syntax.awaitKeyword, e);
              resources = e;
            }
            const body = this.embedded(syntax.statement);
            return stmt('Using', syntax, body.completes, { resources, body });
          } finally {
            this.popScope();
          }
        }
        case 'TryStatement':
          return this.tryStatement(syntax);
        case 'YieldReturnStatement':
        case 'YieldBreakStatement': {
          this.c.isIterator = true;
          this.rootBinder.isIterator = true;
          if (syntax.kind === 'YieldBreakStatement') return stmt('YieldBreak', syntax, false, {});
          const element = this.iteratorElementType(),
            e = this.value(syntax.expression);
          return stmt('YieldReturn', syntax, true, { expression: element ? this.convert(e, element, syntax.expression) : e });
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
      if (first) this.report(first.firstToken() ?? first, 'CS0162');
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
      if (!e.hasErrors && !this.isStatementExpression(syntax)) this.report(syntax, 'CS0201');
      return e;
    }
    declareLabel(syntax) {
      const name = syntax.identifier.valueText,
        root = this;
      root.labels ??= [];
      if (root.labels.some(l => l.name === name)) {
        this.report(syntax.identifier, 'CS0140', [name]);
        return;
      }
      const label = new LabelSymbol({ name, syntax });
      label.uses = 0;
      label.binder = this;
      label.depth = this.scopes.length;
      root.labels.push(label);
      this.hasLabels = true;
      this.rootBinder.hasLabelsAnywhere = true;
      (this.rootBinder.allLabels ??= []).push({ label, node: syntax.identifier, uri: this.c.uri });
    }
    findLabel(name) {
      for (let b = this; b; b = b.c.isLambda || b.c.isLocalFunction ? null : b.c.parent) {
        const l = (b.labels ?? []).find(x => x.name === name && x.depth <= b.scopes.length);
        if (l) return l;
      }
      return null;
    }
  };
