/**
 * Async streams lowered from bound trees (SF-A02-T09.4): async iterators, `await foreach` and `await using`.
 *
 * An async iterator is an iterator state machine (lowering/iterators.js) whose body may also await. An await inside
 * `MoveNext` suspends the context that called it, so the consumer of the stream is suspended exactly as if it awaited
 * the `ValueTask<bool>` of `MoveNextAsync`:
 *
 *   await foreach (T x in stream) body
 *     ->  e = GetEnumerator(stream); try { while (MoveNext(e)) { T x = e.current; body } } finally { Dispose(e); }
 *
 * Outside `await foreach` the members of `IAsyncEnumerator<T>` are tasks of their own: `e.MoveNextAsync()` starts
 * `MoveNext` as an async context (`Async.Start`) and yields its task, and so does `e.DisposeAsync()`.
 *
 * `await foreach` over a type with the `GetAsyncEnumerator` pattern, and `await using`, await the tasks their members
 * return.
 */
import { SymbolKind } from '../../symbols/types.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** Class mixin for the body translator: `await foreach`, `await using` and the async members of iterator objects. */
export const AsyncStreamTranslation = Base =>
  class extends Base {
    /** `await foreach` over a collection that is not an iterator object: the awaitable enumerator pattern. */
    forEachAwaitPattern(node) {
      const type = node.collection.type,
        members = node.enumeration;
      if (!members?.getEnumerator) return this.unsupported(`await foreach over '${type.toDisplayString()}'`, node.syntax);
      const enumeratorType = members.getEnumerator.returnType,
        span = this.span(node.syntax);
      return this.scoped(() => {
        const holder = this.holder(this.imageType(enumeratorType, node.syntax), 'enumerator'),
          awaited = method => this.g.awaitTask(this.memberCall(method, holder.read(), [], node.syntax), node.syntax);
        const element = this.propertyReference({ property: members.current, type: members.current.type, syntax: node.syntax, receiver: null });
        element.receiver = holder.read();
        const body = () =>
          this.scoped(() => {
            const elementType = this.imageType(node.local.type, node.syntax),
              value = element.legacyType === elementType ? element : n.convert(element, elementType);
            return [...this.declareVariable(node.local, value, span), this.embedded(node.body)];
          });
        const loop = () => n.whileStatement(awaited(members.moveNext), body(), span),
          // An extension GetAsyncEnumerator is a static method that takes the collection as its argument.
          start = members.isExtension
            ? this.memberCall(members.getEnumerator, null, [this.expression(node.collection)], node.syntax)
            : this.memberCall(members.getEnumerator, this.expression(node.collection), [], node.syntax),
          statements = [holder.init(start, span)];
        if (!members.dispose) statements.push(loop());
        else statements.push(this.protect(node.body, loop, () => n.block([n.expressionStatement(awaited(members.dispose))])));
        return statements;
      });
    }
    /** `e.MoveNextAsync()` and `e.DisposeAsync()` on an iterator object: the task of the dispatcher run as an async context. */
    iteratorTask(info, memberName, receiver) {
      const thunks = this.g.iterators.asyncThunks(info),
        isMoveNext = memberName === 'MoveNextAsync';
      return this.g.startTask(isMoveNext ? 'bool' : 'void', isMoveNext ? thunks.moveNext : thunks.dispose, receiver);
    }
    /** `await resource.DisposeAsync()` for `await using`. */
    disposeAsyncCall(resource, syntax) {
      const iterator = this.g.iterators.infoOf(this.imageType(resource.type, syntax));
      if (iterator) return n.call(iterator.dispose, null, [resource.read()]);
      const dispose = resource.type.getMembers('DisposeAsync').find(m => m.kind === SymbolKind.Method && !m.parameters.length);
      if (!dispose) return this.unsupported('await using a resource without a DisposeAsync method', syntax);
      return this.g.awaitTask(this.memberCall(dispose, resource.read(), [], syntax), syntax);
    }
  };
