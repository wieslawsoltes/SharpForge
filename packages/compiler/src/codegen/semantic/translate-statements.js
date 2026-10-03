/**
 * Lowering of statements: blocks and declarations, control flow, loops over arrays and enumerators, exception
 * handling and resource disposal.
 */
import { SymbolKind } from '../../symbols/types.js';
import { walk } from '../../bound/semantic-walker.js';
import { yieldBreak } from '../../lowering/iterators.js';
import { yieldReturn, openRegion, closeRegion } from '../../lowering/iterators/try-regions.js';
import { n } from './node-factory.js';
import { exceptionTypeName } from '../../symbols/exception-identity.js';

/** True when a `yield return` of the enclosing iterator suspends inside `node`. */
const suspendsInside = node => {
  let found = false;
  walk(node, child => {
    if (child.kind === 'YieldReturn') found = true;
    return !found && child.kind !== 'Lambda' && child.kind !== 'LocalFunction';
  });
  return found;
};

/** True for `IEnumerable<T>` and `IEnumerable`: a sequence is enumerated through a fresh enumerator. */
const isEnumerableType = (type, core) => type.originalDefinition === core.ienumerableT || type === core.ienumerable;

/** Class mixin: statements. */
export const StatementTranslation = Base =>
  class extends Base {
    /** Lowers a statement; variables its expressions introduce are declared just before it. */
    statement(node) {
      const handler = this['stmt' + node.kind];
      if (!handler) return this.unsupported(`${node.kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} statements`, node.syntax);
      // Variables introduced by this statement's own expressions are declared around it, not around a nested statement.
      const outer = this.pending;
      this.pending = [];
      try {
        return this.withPending(handler.call(this, node));
      } finally {
        this.pending = outer;
      }
    }
    /** An embedded statement gets its own scope so that its locals are released when it ends. */
    scoped(build) {
      this.scopes.push([]);
      try {
        const statements = build();
        return n.block(Array.isArray(statements) ? statements : [statements], this.scopes.at(-1));
      } finally {
        this.scopes.pop();
      }
    }
    stmtBlock(node) {
      return this.scoped(() => {
        for (const child of node.statements) if (child.kind === 'LocalFunction' && child.method) this.declareLocalFunction(child.method);
        const block = node.statements.map(child => this.statement(child));
        return [{ ...n.block(block), syntax: this.span(node.syntax) }];
      });
    }
    stmtEmpty() {
      return n.noOp();
    }
    stmtLocalFunction() {
      return n.noOp();
    }
    stmtExpressionStatement(node) {
      return n.expressionStatement(this.effect(node.expression), this.span(node.syntax));
    }
    stmtLocalDeclaration(node) {
      const span = this.span(node.syntax),
        statements = [];
      for (const declarator of node.declarations) {
        const symbol = declarator.local;
        if (!symbol) return this.unsupported('this declaration form', node.syntax);
        if (symbol.isRef) return this.unsupported('ref locals', node.syntax);
        if (symbol.isUsing && !node.isUsingStatement) return this.unsupported('using declarations', node.syntax);
        const type = this.imageType(symbol.type, node.syntax);
        const value = declarator.value ? this.expression(declarator.value) : this.defaultValue(type);
        statements.push(...this.declareVariable(symbol, value, span));
      }
      return statements.length === 1 ? statements[0] : n.block(statements);
    }
    stmtIf(node) {
      return n.ifStatement(
        this.expression(node.condition),
        this.embedded(node.then),
        node.otherwise ? this.embedded(node.otherwise) : null,
        this.span(node.syntax),
      );
    }
    embedded(node) {
      return node.kind === 'Block' ? this.statement(node) : this.scoped(() => this.statement(node));
    }
    /** A loop condition is evaluated on every iteration, so the variables it introduces are declared before the loop. */
    loop(node, build) {
      return build();
    }
    stmtWhile(node) {
      return this.loop(node, () => n.whileStatement(this.expression(node.condition), this.embedded(node.body), this.span(node.syntax)));
    }
    stmtDo(node) {
      return this.loop(node, () => ({
        kind: 'DoStatement',
        syntax: this.span(node.syntax),
        locals: [],
        body: this.embedded(node.body),
        condition: this.expression(node.condition),
        labels: [],
      }));
    }
    stmtFor(node) {
      return this.scoped(() =>
        this.loop(node, () => {
          const initializers = [];
          if (node.declaration) initializers.push(this.stmtLocalDeclaration({ declarations: node.declaration, syntax: node.syntax.declaration }));
          for (const e of node.initializers ?? []) initializers.push(n.expressionStatement(this.effect(e), this.span(e.syntax)));
          const increments = (node.incrementors ?? []).map(e => this.effect(e));
          const increment = !increments.length
            ? null
            : increments.length === 1
              ? increments[0]
              : n.sequence([], increments.slice(0, -1), increments.at(-1));
          return {
            kind: 'ForStatement',
            syntax: this.span(node.syntax),
            locals: [],
            initializer: initializers.length ? n.block(initializers) : null,
            condition: node.condition ? this.expression(node.condition) : null,
            body: this.embedded(node.body),
            increment,
            labels: [],
          };
        }),
      );
    }
    stmtForEach(node) {
      if (!node.local) return this.unsupported('deconstruction in foreach', node.syntax);
      const collection = node.collection,
        type = collection.type;
      const iterator = type && !type.elementType ? this.g.iterators.infoOf(this.imageType(type, node.syntax)) : null;
      if (iterator) {
        const source = () => this.expression(collection),
          fresh = () => n.call(iterator.getEnumerator, null, [source()]);
        return this.forEachIterator(node, iterator, isEnumerableType(type, this.g.analysis.core) ? fresh : source);
      }
      if (type?.elementType && type.rank === 1) return this.frame.hoist ? this.forEachArrayHoisted(node) : this.forEachArray(node);
      return this.forEachEnumerator(node);
    }
    /** foreach over an IEnumerable<T> or IEnumerator<T> produced by an iterator: the shared class's dispatchers drive it. */
    forEachIterator(node, info, start) {
      return this.scoped(() => {
        const span = this.span(node.syntax),
          enumerator = this.holder(info.record.name, 'enumerator');
        const body = () => this.scoped(() => {
          const elementType = this.imageType(node.local.type, node.syntax),
            current = n.field(enumerator.read(), info.currentField),
            value = current.legacyType === elementType ? current : n.convert(current, elementType);
          return [...this.declareVariable(node.local, value, span), this.embedded(node.body)];
        });
        const loop = () => n.whileStatement(n.call(info.moveNext, null, [enumerator.read()]), body(), span),
          dispose = () => n.block([n.expressionStatement(n.call(info.dispose, null, [enumerator.read()]))]);
        return [enumerator.init(start(), span), this.protect(node.body, loop, dispose)];
      });
    }
    /**
     * `try { body } finally { cleanup }` around lowered statements. In a state machine a `yield return` inside `source`
     * suspends the method in the middle of the try block, which takes a try region instead of a plain statement.
     * @param source the bound node the protected statements come from  @param body,cleanup build the lowered blocks
     */
    protect(source, body, cleanup) {
      const hoist = this.frame.hoist;
      if (!hoist || !suspendsInside(source)) return n.tryStatement(body(), [], cleanup());
      const region = openRegion(hoist),
        protectedBlock = body();
      return closeRegion(hoist, region, protectedBlock, cleanup());
    }
    /** foreach over an array inside a state machine: the array and the index are hoisted, so a `yield` in the body keeps them. */
    forEachArrayHoisted(node) {
      return this.scoped(() => {
        const span = this.span(node.syntax),
          source = this.expression(node.collection),
          array = this.holder(source.legacyType, 'array'),
          index = this.holder('int', 'index'),
          elementType = this.imageType(node.local.type, node.syntax);
        const body = this.scoped(() => {
          const element = n.arrayElement(array.read(), index.read()),
            value = element.legacyType === elementType ? element : n.convert(element, elementType);
          return [...this.declareVariable(node.local, value, span), this.embedded(node.body)];
        });
        const loop = {
          kind: 'ForStatement',
          syntax: span,
          locals: [],
          initializer: null,
          condition: n.binary('<', index.read(), n.arrayLength(array.read()), 'bool'),
          body,
          increment: n.increment('++', index.read(), true),
          labels: [],
        };
        return [array.init(source, span), index.init(n.literal(0, 'int')), loop];
      });
    }
    stmtYieldReturn(node) {
      const hoist = this.frame.hoist;
      if (!hoist) return this.unsupported('yield outside an iterator method', node.syntax);
      return yieldReturn(hoist, this.expression(node.expression), this.span(node.syntax));
    }
    stmtYieldBreak(node) {
      const hoist = this.frame.hoist;
      if (!hoist) return this.unsupported('yield outside an iterator method', node.syntax);
      return yieldBreak(hoist, this.span(node.syntax));
    }
    /** foreach over an array: the emitter indexes it; a captured iteration variable gets a fresh cell per iteration. */
    forEachArray(node) {
      return this.scoped(() => {
        const span = this.span(node.syntax),
          symbol = node.local,
          elementType = this.imageType(symbol.type, node.syntax),
          array = this.expression(node.collection);
        const body = [];
        let iteration;
        if (this.frame.captures.isCaptured(symbol) || array.legacyType !== elementType + '[]') {
          // The slot the emitter fills holds the element; the source variable is declared from it inside the body.
          iteration = this.temp(array.legacyType.slice(0, -2), symbol.name);
          const value = array.legacyType === elementType + '[]' ? n.local(iteration) : n.convert(n.local(iteration), elementType);
          body.push(...this.declareVariable(symbol, value));
        } else {
          iteration = n.newLocal(symbol.name, elementType, n.spanOf(symbol.syntax, this.frame.uri), { hidden: false, isIteration: true });
          this.frame.vars.set(symbol, () => n.local(iteration));
        }
        body.push(this.embedded(node.body));
        return {
          kind: 'ForEachStatement',
          syntax: span,
          expression: array,
          enumerator: null,
          iterationVariable: iteration,
          locals: [iteration],
          body: n.block(body),
          labels: [],
        };
      });
    }
    /**
     * foreach over the enumerator pattern:
     * `{ E e = c.GetEnumerator(); try { while (e.MoveNext()) { T x = e.Current; body } } finally { e.Dispose(); } }`.
     */
    forEachEnumerator(node) {
      const type = node.collection.type,
        member = (owner, name) => owner.getMembers(name).find(m => m.kind === SymbolKind.Method && !m.parameters.length && !m.isStatic),
        getEnumerator = type && member(type, 'GetEnumerator');
      if (!getEnumerator) return this.unsupported('foreach over a type without an accessible GetEnumerator method', node.syntax);
      const enumeratorType = getEnumerator.returnType,
        moveNext = member(enumeratorType, 'MoveNext'),
        current = enumeratorType.getMembers('Current').find(m => m.kind === SymbolKind.Property),
        dispose = member(enumeratorType, 'Dispose');
      if (!moveNext || !current) return this.unsupported('foreach over this enumerator type', node.syntax);
      // A GetEnumerator that is itself an iterator returns the shared iterator class.
      const iterator = this.g.iterators.infoOf(this.imageType(enumeratorType, node.syntax));
      const start = () => this.memberCall(getEnumerator, this.expression(node.collection), [], node.syntax);
      if (iterator) return this.forEachIterator(node, iterator, start);
      return this.scoped(() => {
        const span = this.span(node.syntax),
          holder = this.holder(this.imageType(enumeratorType, node.syntax), 'enumerator'),
          read = holder.read;
        const callOn = method => this.memberCall(method, read(), [], node.syntax);
        const element = this.propertyReference({ property: current, type: current.type, syntax: node.syntax, receiver: null });
        element.receiver = read();
        const body = () => this.scoped(() => {
          const elementType = this.imageType(node.local.type, node.syntax);
          const value = element.legacyType === elementType ? element : n.convert(element, elementType);
          return [...this.declareVariable(node.local, value, span), this.embedded(node.body)];
        });
        const loop = () => n.whileStatement(callOn(moveNext), body(), span);
        const statements = [holder.init(this.memberCall(getEnumerator, this.expression(node.collection), [], node.syntax), span)];
        if (dispose) statements.push(this.protect(node.body, loop, () => n.block([n.expressionStatement(callOn(dispose))])));
        else statements.push(loop());
        return statements;
      });
    }
    /** `resource.Dispose()`: an iterator object is disposed through its class's dispatcher, anything else by its method. */
    disposeCall(resource, syntax) {
      const iterator = this.g.iterators.infoOf(this.imageType(resource.type, syntax));
      if (iterator) return n.call(iterator.dispose, null, [resource.read()]);
      const dispose = resource.type.getMembers('Dispose').find(m => m.kind === SymbolKind.Method && !m.parameters.length);
      if (!dispose) return this.unsupported('using a resource without a Dispose method', syntax);
      return this.memberCall(dispose, resource.read(), [], syntax);
    }
    /** A call of a parameterless-or-not instance method that is either a source method or a framework member. */
    memberCall(method, receiver, args, syntax) {
      const definition = method.originalDefinition ?? method;
      if (this.g.isSource(definition)) return n.call(this.g.methodOf(definition, syntax), receiver, args);
      if (method.contract || method.builtin) return n.frameworkCall(method, receiver, args, this.imageType(method.returnType, syntax));
      return this.unsupported(`'${method.toDisplayString()}' (not in the framework registry)`, syntax);
    }
    /** The jump target of a label name; labels are scoped to the method body. */
    labelOf(name) {
      this.frame.labels ??= new Map();
      let label = this.frame.labels.get(name);
      if (!label) this.frame.labels.set(name, (label = { name }));
      return label;
    }
    stmtLabeled(node) {
      return n.block([{ kind: 'LabelStatement', syntax: n.hidden, label: this.labelOf(node.label) }, this.statement(node.statement)]);
    }
    /** `goto label;` is a jump; `goto case` and `goto default` need the switch to be a jump table and are not lowered. */
    stmtGoto(node) {
      const target = node.syntax.expression;
      if (node.syntax.kind !== 'GotoStatement' || target?.kind !== 'IdentifierName') return this.unsupported('goto case and goto default', node.syntax);
      return n.block([
        n.expressionStatement(n.nullLiteral('object'), this.span(node.syntax)),
        { kind: 'GotoStatement', syntax: n.hidden, label: this.labelOf(target.identifier.valueText) },
      ]);
    }
    stmtBreak(node) {
      if (node.syntax.label) return this.unsupported('labeled break and continue', node.syntax);
      return { kind: 'BreakStatement', syntax: this.span(node.syntax), label: null };
    }
    stmtContinue(node) {
      if (node.syntax.label) return this.unsupported('labeled break and continue', node.syntax);
      return { kind: 'ContinueStatement', syntax: this.span(node.syntax), label: null };
    }
    stmtReturn(node) {
      return n.returnStatement(node.expression ? this.expression(node.expression) : null, this.span(node.syntax));
    }
    stmtThrow(node) {
      return n.throwStatement(node.expression ? this.expression(node.expression) : null, this.span(node.syntax));
    }
    stmtChecked(node) {
      return this.statement(node.block);
    }
    stmtTry(node) {
      const catches = node.catches.map(clause => {
        const type = exceptionTypeName(clause.type);
        let variable = null;
        let filter = null;
        const body = this.scoped(() => {
          if (clause.local) {
            if (this.frame.captures.isCaptured(clause.local)) return this.unsupported('a captured catch variable', node.syntax);
            variable = n.newLocal(clause.local.name, type, n.spanOf(clause.local.syntax, this.frame.uri), { hidden: false });
            this.frame.vars.set(clause.local, () => n.local(variable));
          }
          filter = clause.filter ? this.expression(clause.filter) : null;
          return this.statement(clause.block);
        });
        body.syntax = this.span(clause.block.syntax);
        return { kind: 'CatchBlock', exceptionType: type, local: variable, filter, body };
      });
      const span = this.span(node.syntax);
      if (!catches.length && node.finallyBlock) {
        const statement = this.protect(node.body, () => this.statement(node.body), () => this.statement(node.finallyBlock));
        return statement.kind === 'TryStatement' ? { ...statement, syntax: span } : statement;
      }
      return n.tryStatement(this.statement(node.body), catches, node.finallyBlock ? this.statement(node.finallyBlock) : null, span);
    }
    /** `using (R r = e) body` is `{ R r = e; try body finally { if (r != null) r.Dispose(); } }`. */
    stmtUsing(node) {
      return this.scoped(() => {
        const statements = [],
          resources = [];
        if (Array.isArray(node.resources)) {
          for (const declarator of node.resources) {
            statements.push(...this.declareVariable(declarator.local, this.expression(declarator.value), this.span(node.syntax)));
            resources.push({ read: () => this.variable(declarator.local, node.syntax), type: declarator.local.type });
          }
        } else if (node.resources) {
          const value = this.expression(node.resources),
            holder = this.holder(value.legacyType, 'using');
          statements.push(holder.init(value, this.span(node.syntax)));
          resources.push({ read: holder.read, type: node.resources.type });
        }
        // The first resource is the outermost try statement, so the regions are built from the outside in.
        const guarded = index => {
          if (index === resources.length) return this.embedded(node.body);
          const resource = resources[index];
          const cleanup = () => {
            const call = n.expressionStatement(this.disposeCall(resource, node.syntax));
            return n.block([n.ifStatement(n.notEquals(resource.read(), n.nullLiteral(resource.read().legacyType)), call)]);
          };
          return this.protect(node.body, () => guarded(index + 1), cleanup);
        };
        return [...statements, guarded(0)];
      });
    }
  };
