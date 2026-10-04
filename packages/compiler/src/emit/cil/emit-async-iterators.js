/**
 * Async streams (SF-A02-T30): the kickoff and `MoveNext` of an async iterator (async-iterator-members.js),
 * `await foreach` and `await using`.
 *
 *   MoveNext   try { switch (state) { n -> resume n }  state = -1; if (disposeMode) goto finished;  body }
 *              catch (Exception e) { state = -2; promise.SetException(e); return; }
 *              finished: state = -2; builder.Complete(); promise.SetResult(false); return;
 *   yield return v   current = v; state = -4 - n; promise.SetResult(true); return;
 *                    resume: state = -1; if (disposeMode) goto finished;
 *   await            as in an async method, through AsyncIteratorMethodBuilder
 *
 *   await foreach (T x in c) body     e = c.GetAsyncEnumerator(default);
 *                                     try { while (await e.MoveNextAsync()) { T x = e.Current; body } }
 *                                     finally { await e.DisposeAsync(); }
 *   await using (R r = v) body        try { body } finally { if (r != null) await r.DisposeAsync(); }
 *
 * The finally blocks of the last two await, so they take the moved form of emit-async-try.js; in dispose mode the
 * jump to `finished` runs them like any other jump out of the region.
 */
import { SymbolKind } from '../../symbols/types.js';
import { findConstruction, implementsInterface } from '../../symbols/substitution.js';
import { AsyncBuilderMembers } from './async-builders.js';
import { awaiterOfValue } from './awaitables.js';
import { asyncStreamTypes } from './async-stream-types.js';
import { isReference } from './type-facts.js';

const NOT_ENUMERATING = -2;
const NOT_STARTED = -3;
const RUNNING = -1;
const FINISHED = -2;
const nothing = { pops: 0, pushes: 0 };

const instance = (returnType, parameters = []) => ({ isStatic: false, returnType, parameters: parameters.map(type => ({ type })) });
const parameterless = (type, name) =>
  type.getMembers(name).find(member => member.kind === SymbolKind.Method && !member.isStatic && member.parameters.every(parameter => parameter.isOptional));

/** Class mixin: async iterators, await foreach, await using. */
export const AsyncIteratorEmission = Base =>
  class extends Base {
    get isAsyncIteratorBody() {
      return this.machine?.kind === 'asyncIterator';
    }
    /** The body of the method the program declared: it creates the async iterator object. */
    asyncIteratorKickoff(machine) {
      const il = this.il,
        receiver = machine.fields.receiver,
        initialState = machine.shape.isEnumerable ? NOT_ENUMERATING : NOT_STARTED;
      il.emit('ldc.i4', initialState).emit('newobj', machine.instanceConstructor.token, { pops: 1, pushes: 1 });
      if (receiver) {
        il.emit('dup');
        this.pushFrameObject();
        if (!isReference(receiver.type)) this.loadIndirect(receiver.type);
        il.emit('stfld', receiver.token);
      }
      for (const [parameter, { field, initial }] of machine.parameters) {
        il.emit('dup');
        this.ownParameterLocation(parameter).load();
        il.emit('stfld', (initial ?? field).token);
      }
      return il.emit('ret', undefined, { pops: 1, pushes: 0 });
    }
    /** `call` of a member of the promise field, whose address and arguments are on the stack. */
    promiseCall(name, parameterTypes) {
      const promise = this.machine.shape.types.promise,
        shape = instance(this.core.void, parameterTypes);
      return this.il.emit('call', this.tokens.external(promise, name, shape), { pops: 1 + parameterTypes.length, pushes: 0 });
    }
    pushPromise() {
      return this.il.emit('ldarg', 0).emit('ldflda', this.machine.fields.promise.token);
    }
    /** `if (disposeMode) goto finished;` */
    leaveWhenDisposing() {
      const il = this.il,
        proceed = il.newLabel();
      il.emit('ldarg', 0).emit('ldfld', this.machine.fields.disposeMode.token).emit('brfalse', proceed);
      this.jump(this.finished, 0);
      il.mark(proceed);
    }
    /** @param bound the bound body of the kickoff  @returns the instruction stream of `MoveNext` */
    asyncIteratorMoveNext(bound) {
      const il = this.il,
        types = this.machine.shape.types,
        resultParameter = types.promiseDefinition.typeParameters[0],
        tryStart = il.newLabel(),
        handlerStart = il.newLabel(),
        handlerEnd = il.newLabel(),
        exception = this.temp(this.core.exception);
      this.beginStates();
      this.builderMembers = new AsyncBuilderMembers(this.program, this.machine);
      this.awaiterFields = new Map();
      this.resultSlot = null;
      this.finished = il.newLabel();
      this.yielded = il.newLabel();
      this.suspended = il.newLabel();
      il.mark(tryStart);
      let dispatch = [];
      this.protect(() => {
        dispatch = this.emitDispatch(this.dispatchScope);
        this.storeState(RUNNING);
        this.leaveWhenDisposing();
        this.enterBody();
        this.statement(bound);
        if (il.isReachable) il.emit('leave', this.finished);
      });
      this.dropUnusedDispatch(dispatch);
      il.mark(handlerStart, 1);
      this.debug?.asyncCatch(handlerStart);
      il.emit('stloc', exception);
      this.storeState(FINISHED);
      this.pushPromise().emit('ldloc', exception);
      this.promiseCall('SetException', [this.core.exception]).emit('leave', this.suspended);
      il.mark(handlerEnd);
      il.addRegion({ kind: 'catch', tryStart, tryEnd: handlerStart, handlerStart, handlerEnd, catchType: this.tokens.type(this.core.exception) });
      il.mark(this.finished);
      this.storeState(FINISHED);
      this.pushBuilder();
      il.emit('call', this.tokens.external(types.builder, 'Complete', instance(this.core.void)), { pops: 1, pushes: 0 });
      this.pushPromise().emit('ldc.i4', 0);
      this.promiseCall('SetResult', [resultParameter]).emit('ret', undefined, nothing);
      il.mark(this.yielded);
      this.pushPromise().emit('ldc.i4', 1);
      this.promiseCall('SetResult', [resultParameter]);
      il.mark(this.suspended);
      il.emit('ret', undefined, nothing);
      this.hoistLocals();
      return il;
    }
    stmtYieldReturn(node) {
      if (!this.isAsyncIteratorBody) return super.stmtYieldReturn(node);
      const il = this.il,
        fields = this.machine.fields,
        resume = il.newLabel(),
        // The value may await: it is evaluated before the machine is pushed for the store.
        value = this.transient(fields.current.type);
      this.expression(node.expression);
      il.emit('stloc', value).emit('ldarg', 0).emit('ldloc', value).emit('stfld', fields.current.token);
      this.storeState(this.newState(resume, { inYieldSeries: true }));
      il.emit('leave', this.yielded);
      this.resumeAt(resume);
      return this.leaveWhenDisposing();
    }
    stmtForEach(node) {
      return node.isAwait && node.local ? this.forEachAsync(node) : super.stmtForEach(node);
    }
    /** Pushes the default value of every parameter of a pattern method (they are all optional). */
    optionalArguments(method, from = 0) {
      for (const parameter of method.parameters.slice(from)) this.defaultValue(parameter.type);
    }
    /** Calls a pattern method whose receiver is on the stack, with the defaults of its optional parameters. */
    callWithDefaults(method, receiver) {
      this.optionalArguments(method);
      return this.callMethod(method, { receiver });
    }
    /**
     * The members `await foreach` enumerates with: the pattern the binder found, or the async-stream interfaces.
     * @returns {{enumeratorType, getEnumerator: () => void, moveNext: {type, call: () => void}, current: {type, call: () => void},
     *   dispose: {type, call: () => void}|null}} each `call` takes its receiver from the stack
     */
    asyncEnumerationOf(node) {
      const { il, core, tokens } = this,
        pattern = node.enumeration ?? {},
        collection = node.collection;
      if (pattern.getEnumerator && !this.isInterfaceGetAsyncEnumerator(pattern.getEnumerator)) {
        const enumeratorType = pattern.getEnumerator.returnType,
          receiver = { kind: 'Temporary', type: enumeratorType },
          member = method => ({ type: method.returnType, call: () => this.callWithDefaults(method, receiver) }),
          isDisposable = implementsInterface(enumeratorType, core.iasyncDisposable, core),
          disposer = pattern.dispose ?? (isDisposable ? parameterless(core.iasyncDisposable, 'DisposeAsync') : null);
        return {
          enumeratorType,
          getEnumerator: () => {
            if (pattern.isExtension) this.expression(collection);
            else this.receiver(collection);
            this.optionalArguments(pattern.getEnumerator, pattern.isExtension ? 1 : 0);
            this.callMethod(pattern.getEnumerator, pattern.isExtension ? {} : { receiver: collection });
          },
          moveNext: member(pattern.moveNext),
          current: { type: pattern.current.type, call: () => this.callMethod(pattern.current.getMethod, { receiver }) },
          dispose: disposer ? member(disposer) : null,
        };
      }
      const elementType = findConstruction(collection.type, core.iasyncEnumerableT, core)?.typeArguments[0].type;
      if (!elementType) return this.unsupported('await foreach over this collection', node.syntax);
      const enumeratorType = core.iasyncEnumeratorT.construct(elementType),
        answer = core.valueTaskT.construct(core.bool),
        call = (owner, name, shape) => il.emit('callvirt', tokens.external(owner, name, shape), { pops: 1 + shape.parameters.length, pushes: 1 });
      return {
        enumeratorType,
        getEnumerator: () => {
          this.expression(collection);
          this.callGetAsyncEnumerator(elementType);
        },
        moveNext: { type: answer, call: () => call(enumeratorType, 'MoveNextAsync', instance(answer)) },
        current: { type: elementType, call: () => call(enumeratorType, 'get_Current', instance(core.iasyncEnumeratorT.typeParameters[0])) },
        dispose: { type: core.valueTask, call: () => call(core.iasyncDisposable, 'DisposeAsync', instance(core.valueTask)) },
      };
    }
    /**
     * True for `IAsyncEnumerable<T>.GetAsyncEnumerator`. The symbol table declares it without its
     * `CancellationToken` parameter; .NET resolves a member by its exact signature, so a call supplies the default.
     */
    isInterfaceGetAsyncEnumerator(method) {
      const owner = method.containingType?.originalDefinition ?? method.containingType;
      return owner === this.core.iasyncEnumerableT && method.name === 'GetAsyncEnumerator' && !method.parameters.length;
    }
    /** `enumerable.GetAsyncEnumerator(default)` for the enumerable on the stack. */
    callGetAsyncEnumerator(elementType) {
      const core = this.core,
        token = asyncStreamTypes(core).cancellationToken,
        shape = instance(core.iasyncEnumeratorT.construct(core.iasyncEnumerableT.typeParameters[0]), [token]);
      this.defaultValue(token);
      return this.il.emit('callvirt', this.tokens.external(core.iasyncEnumerableT.construct(elementType), 'GetAsyncEnumerator', shape), {
        pops: 2,
        pushes: 1,
      });
    }
    exprCall(node) {
      if (node.isOmitted || !node.receiver || !this.isInterfaceGetAsyncEnumerator(node.method)) return super.exprCall(node);
      this.expression(node.receiver);
      return this.callGetAsyncEnumerator(node.method.containingType.typeArguments[0].type);
    }
    forEachAsync(node) {
      if (!this.isAsyncBody) return this.unsupported('await foreach outside an async method', node.syntax);
      const il = this.il,
        members = this.asyncEnumerationOf(node),
        enumeratorType = members.enumeratorType,
        enumerator = this.temp(enumeratorType),
        pushEnumerator = () => il.emit(isReference(enumeratorType) ? 'ldloc' : 'ldloca', enumerator),
        awaited = member => () => {
          pushEnumerator();
          member.call();
        },
        loop = () => {
          const test = il.newLabel(),
            body = il.newLabel(),
            end = il.newLabel();
          il.emit('br', test);
          il.mark(body, 0);
          pushEnumerator();
          members.current.call();
          this.iterationValue(node, members.current.type);
          this.withJumpTargets({ breakLabel: end, continueLabel: test }, () => this.statement(node.body));
          il.mark(test);
          this.awaitWith(awaiterOfValue(this, members.moveNext.type, awaited(members.moveNext), node.syntax), this.core.bool, node.syntax);
          il.emit('brtrue', body);
          il.mark(end);
        };
      members.getEnumerator();
      il.emit('stloc', enumerator);
      if (!members.dispose) return loop();
      return this.movedFinally(loop, () => this.awaitDisposal(enumerator, enumeratorType, members.dispose, node.syntax));
    }
    /** `if (resource != null) await resource.DisposeAsync();` for the resource in `slot`. */
    awaitDisposal(slot, type, dispose, syntax) {
      const il = this.il,
        skip = il.newLabel(),
        isObject = isReference(type),
        push = () => {
          il.emit(isObject ? 'ldloc' : 'ldloca', slot);
          dispose.call();
        };
      if (isObject) il.emit('ldloc', slot).emit('brfalse', skip);
      this.awaitWith(awaiterOfValue(this, dispose.type, push, syntax), this.core.void, syntax);
      il.mark(skip);
    }
    /** `DisposeAsync` of a resource type: the method the type declares, else `IAsyncDisposable.DisposeAsync`. */
    asyncDisposerOf(type, syntax) {
      const core = this.core,
        receiver = { kind: 'Temporary', type },
        declared = parameterless(type, 'DisposeAsync');
      if (declared) return { type: declared.returnType, call: () => this.callWithDefaults(declared, receiver) };
      if (!implementsInterface(type, core.iasyncDisposable, core)) return this.unsupported(`await using over '${type.toDisplayString()}'`, syntax);
      const shape = instance(core.valueTask);
      return {
        type: core.valueTask,
        call: () => this.il.emit('callvirt', this.tokens.external(core.iasyncDisposable, 'DisposeAsync', shape), { pops: 1, pushes: 1 }),
      };
    }
    /** Nested moved-finally regions, one per resource, the first resource outermost. */
    disposeAsyncAround(resources, index, emitBody, syntax) {
      if (index === resources.length) return emitBody();
      const { slot, type } = resources[index];
      return this.movedFinally(
        () => this.disposeAsyncAround(resources, index + 1, emitBody, syntax),
        () => this.awaitDisposal(slot, type, this.asyncDisposerOf(type, syntax), syntax),
      );
    }
    disposeAround(resources, emitBody, { syntax, isAwait }) {
      if (!isAwait || !this.isAsyncBody) return super.disposeAround(resources, emitBody, { syntax, isAwait });
      return this.disposeAsyncAround(resources, 0, emitBody, syntax);
    }
  };
