/**
 * The class of an async iterator (SF-A02-T30), in the shape Roslyn gives it:
 *
 *   sealed class <M>d__N : IAsyncEnumerable<T>, IAsyncEnumerator<T>, IAsyncDisposable,
 *                          IValueTaskSource<bool>, IValueTaskSource, IAsyncStateMachine
 *     <>1__state                  -2 an enumerable nobody enumerates (and a finished enumerator), -3 before the first
 *                                 MoveNextAsync, -1 running, n >= 0 at an await, n <= -4 at a `yield return`
 *     <>t__builder                AsyncIteratorMethodBuilder: runs MoveNext and schedules its continuations
 *     <>v__promiseOfValueOrEnd    ManualResetValueTaskSourceCore<bool>: what MoveNextAsync hands out; MoveNext
 *                                 completes it with true at a `yield return`, false at the end, or the exception
 *     <>2__current, <>w__disposeMode, <>l__initialThreadId, p / <>3__p, <>4__this    as in an iterator
 *
 * `MoveNext` is emitted from the body (emit-async-iterators.js); the other members are fixed and written here. The
 * cancellation token given to `GetAsyncEnumerator` reaches the parameter marked `[EnumeratorCancellation]`.
 */
import { MethodAttributes, FieldAttributes } from '@sharpforge/cil';
import { RefKind } from '../../symbols/types.js';
import { IlBuilder } from './il-builder.js';
import { MethodEmitter } from './method-emitter.js';
import { CONSTRUCTOR_FLAGS, callObjectConstructor, synthesizedMethod } from './synthesized-types.js';
import { frameworkType, methodTypeParameter } from './framework-types.js';
import { asyncStateMachineInterface } from './async-members.js';
import { asyncStreamTypes } from './async-stream-types.js';

const IMPLEMENTATION_FLAGS =
  MethodAttributes.Private | MethodAttributes.Final | MethodAttributes.HideBySig | MethodAttributes.NewSlot | MethodAttributes.Virtual;
const GETTER_FLAGS = IMPLEMENTATION_FLAGS | MethodAttributes.SpecialName;
const NOT_ENUMERATING = -2;
const NOT_STARTED = -3;
const RUNNING = -1;
/** The explicit implementation of the untyped source's GetResult is named after its interface. */
const SOURCES_PREFIX = 'System.Threading.Tasks.Sources.IValueTaskSource.';

const sameDefinition = (type, definition) => !!type && (type.originalDefinition ?? type) === definition;
const instance = (returnType, parameters = []) => ({ isStatic: false, returnType, parameters: parameters.map(type => ({ type })) });
const done = il => il.emit('ret', undefined, { pops: 0, pushes: 0 });
const returned = il => il.emit('ret', undefined, { pops: 1, pushes: 0 });

/**
 * What an async iterator's return type makes of it, or null for another type.
 * @returns {{elementType, isEnumerable: boolean, enumerable, enumerator, interfaces: object[]}|null}
 */
export function asyncIteratorShapeOf(returnType, core) {
  const isEnumerable = sameDefinition(returnType, core.iasyncEnumerableT);
  if (!isEnumerable && !sameDefinition(returnType, core.iasyncEnumeratorT)) return null;
  const elementType = returnType.typeArguments[0].type,
    types = asyncStreamTypes(core),
    enumerable = core.iasyncEnumerableT.construct(elementType),
    enumerator = core.iasyncEnumeratorT.construct(elementType),
    enumeratorHalf = [enumerator, core.iasyncDisposable, types.typedSource, types.source, asyncStateMachineInterface(core)];
  return { elementType, isEnumerable, enumerable, enumerator, types, interfaces: isEnumerable ? [enumerable, ...enumeratorHalf] : enumeratorHalf };
}

/** The members of the promise and of the builder, as instructions; the address of the field is on the stack. */
class Members {
  constructor(program, machine) {
    this.program = program;
    this.core = program.core;
    this.machine = machine;
    this.types = machine.shape.types;
  }
  promise(il, name, returnType, parameters, pushes) {
    const shape = instance(returnType, parameters);
    return il.emit('call', this.program.tokens.external(this.types.promise, name, shape), { pops: 1 + parameters.length, pushes });
  }
  pushPromise(il) {
    return il.emit('ldarg', 0).emit('ldflda', this.machine.fields.promise.token);
  }
  pushBuilder(il) {
    return il.emit('ldarg', 0).emit('ldflda', this.machine.fields.builder.token);
  }
  createBuilder(il) {
    const shape = { isStatic: true, returnType: this.types.builder, parameters: [] };
    return il.emit('call', this.program.tokens.external(this.types.builder, 'Create', shape), { pops: 0, pushes: 1 });
  }
  /** `promise.Reset(); var machine = this; builder.MoveNext(ref machine);` */
  runMoveNext(il, self) {
    const moveNext = { isStatic: false, arity: 1, returnType: this.core.void, parameters: [{ type: methodTypeParameter(0), refKind: RefKind.Ref }] };
    this.promise(this.pushPromise(il), 'Reset', this.core.void, [], 0);
    il.emit('ldarg', 0).emit('stloc', self);
    this.pushBuilder(il).emit('ldloca', self);
    return il.emit('call', this.program.tokens.externalGeneric(this.types.builder, 'MoveNext', moveNext, [this.machine.type]), { pops: 2, pushes: 0 });
  }
  /** `promise.Version` */
  version(il) {
    return this.promise(this.pushPromise(il), 'get_Version', this.core.short, [], 1);
  }
  /** `newobj ValueTask<bool>(...)` / `ValueTask(...)` over the given constructor parameters. */
  newValueTask(il, taskType, parameters) {
    const shape = { isStatic: false, returnType: this.core.void, parameters: parameters.map(type => ({ type })) };
    return il.emit('newobj', this.program.tokens.external(taskType, '.ctor', shape), { pops: parameters.length, pushes: 1 });
  }
}

/** `.ctor(int state)`: the state, the creating thread and a fresh builder. */
function constructorBody(program, machine) {
  const il = callObjectConstructor(program, new IlBuilder()),
    fields = machine.fields,
    members = new Members(program, machine),
    environment = frameworkType(program.core, 'System', 'Environment'),
    threadId = { isStatic: true, returnType: program.core.int, parameters: [] };
  il.emit('ldarg', 0).emit('ldarg', 1).emit('stfld', fields.state.token);
  il.emit('ldarg', 0);
  il.emit('call', program.tokens.external(environment, 'get_CurrentManagedThreadId', threadId), { pops: 0, pushes: 1 });
  il.emit('stfld', fields.initialThreadId.token);
  il.emit('ldarg', 0);
  members.createBuilder(il).emit('stfld', fields.builder.token);
  return done(il);
}

/** `IAsyncEnumerable<T>.GetAsyncEnumerator`: the enumerable itself the first time on its thread, else a new machine. */
function getAsyncEnumeratorBody(program, machine) {
  const il = new IlBuilder(),
    fields = machine.fields,
    members = new Members(program, machine),
    environment = frameworkType(program.core, 'System', 'Environment'),
    threadId = { isStatic: true, returnType: program.core.int, parameters: [] },
    result = il.declareLocal(machine.type),
    create = il.newLabel(),
    copy = il.newLabel();
  il.emit('ldarg', 0).emit('ldfld', fields.state.token).emit('ldc.i4', NOT_ENUMERATING).emit('bne.un', create);
  il.emit('ldarg', 0).emit('ldfld', fields.initialThreadId.token);
  il.emit('call', program.tokens.external(environment, 'get_CurrentManagedThreadId', threadId), { pops: 0, pushes: 1 });
  il.emit('bne.un', create);
  il.emit('ldarg', 0).emit('ldc.i4', NOT_STARTED).emit('stfld', fields.state.token);
  il.emit('ldarg', 0);
  members.createBuilder(il).emit('stfld', fields.builder.token);
  il.emit('ldarg', 0).emit('ldc.i4', 0).emit('stfld', fields.disposeMode.token);
  il.emit('ldarg', 0).emit('stloc', result).emit('br', copy);
  il.mark(create);
  il.emit('ldc.i4', NOT_STARTED).emit('newobj', machine.instanceConstructor.token, { pops: 1, pushes: 1 }).emit('stloc', result);
  if (fields.receiver) il.emit('ldloc', result).emit('ldarg', 0).emit('ldfld', fields.receiver.token).emit('stfld', fields.receiver.token);
  il.mark(copy);
  for (const [parameter, { field, initial }] of machine.parameters) {
    if (isEnumeratorCancellation(parameter)) enumeratorToken(program, il, { result, field, initial });
    else il.emit('ldloc', result).emit('ldarg', 0).emit('ldfld', initial.token).emit('stfld', field.token);
  }
  return returned(il.emit('ldloc', result));
}

const isEnumeratorCancellation = parameter =>
  !!(parameter.originalDefinition ?? parameter).boundAttributes?.some(attribute => attribute.attributeClass?.name === 'EnumeratorCancellationAttribute');

/**
 * The token of a parameter marked `[EnumeratorCancellation]`: the token `GetAsyncEnumerator` receives when the
 * iterator was called without one (and the other way round), else a token linked to both. (The linked source is not
 * disposed with the enumerator, as Roslyn's is; it is collected with it.)
 * @param {{result: number, field: object, initial: object}} target the new machine's local, the parameter's field and its initial value
 */
function enumeratorToken(program, il, { result, field, initial }) {
  const core = program.core,
    token = asyncStreamTypes(core).cancellationToken,
    source = frameworkType(core, 'System.Threading', 'CancellationTokenSource'),
    equals = program.tokens.external(token, 'Equals', instance(core.bool, [token])),
    link = program.tokens.external(source, 'CreateLinkedTokenSource', { isStatic: true, returnType: source, parameters: [{ type: token }, { type: token }] }),
    getToken = program.tokens.external(source, 'get_Token', instance(token)),
    none = il.declareLocal(token),
    useArgument = il.newLabel(),
    useInitial = il.newLabel(),
    stored = il.newLabel();
  il.emit('ldarg', 0).emit('ldflda', initial.token).emit('ldloc', none).emit('call', equals, { pops: 2, pushes: 1 }).emit('brtrue', useArgument);
  il.emit('ldarga', 1).emit('ldloc', none).emit('call', equals, { pops: 2, pushes: 1 }).emit('brtrue', useInitial);
  il.emit('ldloc', result).emit('ldarg', 0).emit('ldfld', initial.token).emit('ldarg', 1);
  il.emit('call', link, { pops: 2, pushes: 1 }).emit('callvirt', getToken, { pops: 1, pushes: 1 }).emit('stfld', field.token).emit('br', stored);
  il.mark(useArgument);
  il.emit('ldloc', result).emit('ldarg', 1).emit('stfld', field.token).emit('br', stored);
  il.mark(useInitial);
  il.emit('ldloc', result).emit('ldarg', 0).emit('ldfld', initial.token).emit('stfld', field.token);
  il.mark(stored);
}

/**
 * `MoveNextAsync`: a finished enumerator answers false; otherwise the body runs to its next suspension, and the
 * answer is the promise - already completed when the body reached a `yield return` or its end without waiting.
 */
function moveNextAsyncBody(program, machine) {
  const il = new IlBuilder(),
    core = program.core,
    members = new Members(program, machine),
    { status, typedSourceDefinition, promiseDefinition } = machine.shape.types,
    answer = core.valueTaskT.construct(core.bool),
    nothing = il.declareLocal(answer),
    self = il.declareLocal(machine.type),
    version = il.declareLocal(core.short),
    run = il.newLabel(),
    pending = il.newLabel();
  il.emit('ldarg', 0).emit('ldfld', machine.fields.state.token).emit('ldc.i4', NOT_ENUMERATING).emit('bne.un', run);
  il.emit('ldloca', nothing).emit('initobj', program.tokens.type(answer)).emit('ldloc', nothing);
  returned(il);
  il.mark(run);
  members.runMoveNext(il, self);
  members.version(il).emit('stloc', version);
  members.promise(members.pushPromise(il).emit('ldloc', version), 'GetStatus', status, [core.short], 1);
  // ValueTaskSourceStatus.Succeeded is 1.
  il.emit('ldc.i4', 1).emit('bne.un', pending);
  members.promise(members.pushPromise(il).emit('ldloc', version), 'GetResult', promiseDefinition.typeParameters[0], [core.short], 1);
  returned(members.newValueTask(il, answer, [core.valueTaskT.typeParameters[0]]));
  il.mark(pending);
  il.emit('ldarg', 0).emit('ldloc', version);
  // `ValueTask<TResult>(IValueTaskSource<TResult>, short)`: the signature is over the type parameter of ValueTask.
  const sourceOfResult = typedSourceDefinition.construct(core.valueTaskT.typeParameters[0]);
  return returned(members.newValueTask(il, answer, [sourceOfResult, core.short]));
}

/**
 * `DisposeAsync`: an enumerator that is running or awaiting cannot be disposed; one that is finished has nothing to
 * do; one suspended at a `yield return` (or not started) resumes in dispose mode and runs its pending finally blocks.
 */
function disposeAsyncBody(program, machine) {
  const il = new IlBuilder(),
    core = program.core,
    members = new Members(program, machine),
    fields = machine.fields,
    notSupported = core.bridge.coreType('System_NotSupportedException'),
    nothing = il.declareLocal(core.valueTask),
    self = il.declareLocal(machine.type),
    idle = il.newLabel(),
    resume = il.newLabel();
  il.emit('ldarg', 0).emit('ldfld', fields.state.token).emit('ldc.i4', RUNNING).emit('blt', idle);
  il.emit('newobj', program.tokens.external(notSupported, '.ctor', instance(core.void)), { pops: 0, pushes: 1 }).emit('throw');
  il.mark(idle);
  il.emit('ldarg', 0).emit('ldfld', fields.state.token).emit('ldc.i4', NOT_ENUMERATING).emit('bne.un', resume);
  il.emit('ldloca', nothing).emit('initobj', program.tokens.type(core.valueTask)).emit('ldloc', nothing);
  returned(il);
  il.mark(resume);
  il.emit('ldarg', 0).emit('ldc.i4', 1).emit('stfld', fields.disposeMode.token);
  members.runMoveNext(il, self);
  il.emit('ldarg', 0);
  members.version(il);
  return returned(members.newValueTask(il, core.valueTask, [members.types.source, core.short]));
}

/**
 * A method that forwards its arguments to the member `name` of the promise.
 * @param returnType the declared return type of the promise member  @param {object[]} parameters its parameter types
 * @param {boolean} discardsResult the forwarding method returns nothing (`IValueTaskSource.GetResult`)
 */
function forwardToPromise(name, returnType, parameters, discardsResult = false) {
  return (program, machine) => {
    const il = new IlBuilder(),
      members = new Members(program, machine),
      hasResult = returnType.specialType !== 'System_Void';
    members.pushPromise(il);
    parameters.forEach((_, index) => il.emit('ldarg', index + 1));
    members.promise(il, name, returnType, parameters, hasResult ? 1 : 0);
    if (hasResult && discardsResult) il.emit('pop');
    return il.emit('ret', undefined, { pops: hasResult && !discardsResult ? 1 : 0, pushes: 0 });
  };
}

function currentBody(program, machine) {
  return returned(new IlBuilder().emit('ldarg', 0).emit('ldfld', machine.fields.current.token));
}

function moveNextBody(program, machine) {
  const kickoff = machine.kickoff,
    emitter = new MethodEmitter(program, {
      uri: kickoff.uri,
      containingType: kickoff.owner,
      isStatic: kickoff.isStatic,
      parameters: kickoff.parameters,
      returnType: kickoff.returnType,
      method: kickoff.method,
      function: kickoff.function,
      stateMachine: machine,
    });
  return emitter.asyncIteratorMoveNext(kickoff.body);
}

/**
 * Declares the fields and methods of an async iterator class.
 * @param plan the StateMachinePlan  @param machine the StateMachine being planned  @param shape `asyncIteratorShapeOf`
 */
export function declareAsyncIterator(plan, machine, shape) {
  const core = plan.core,
    type = machine.definition,
    types = shape.types,
    methods = plan.additionsTo(type).methods,
    privateField = (name, fieldType) => plan.field(type, name, fieldType, FieldAttributes.Private),
    slot = (owner, name, signature) => ({ owner, name, shape: signature }),
    /** A private method that fills the given interface slots; `signature` is its own. */
    implement = (name, signature, slots, emitBody, { flags = IMPLEMENTATION_FLAGS, parameterNames = [] } = {}) => {
      const method = synthesizedMethod(name, flags, signature, parameterNames, program => emitBody(program, machine));
      method.interfaceSlots = slots;
      methods.push(method);
      return method;
    },
    stateMachine = asyncStateMachineInterface(core),
    promiseResult = types.promiseDefinition.typeParameters[0],
    sourceResult = types.typedSourceDefinition.typeParameters[0],
    onCompleted = [core.action(1).construct(core.object), core.object, core.short, types.flags],
    answer = core.valueTaskT.construct(core.bool),
    token = { parameterNames: ['token'] },
    nothing = instance(core.void),
    byToken = returnType => instance(returnType, [core.short]);
  machine.shape = shape;
  machine.builder = { builderType: types.builder, resultType: null, taskType: null };
  machine.fields.builder = plan.field(type, '<>t__builder', types.builder);
  machine.fields.promise = plan.field(type, '<>v__promiseOfValueOrEnd', types.promise);
  machine.fields.current = privateField('<>2__current', shape.elementType);
  machine.fields.disposeMode = privateField('<>w__disposeMode', core.bool);
  machine.fields.initialThreadId = privateField('<>l__initialThreadId', core.int);
  for (const parameter of machine.kickoff.parameters) {
    machine.parameters.set(parameter, {
      field: plan.field(type, parameter.name, parameter.type),
      initial: shape.isEnumerable ? plan.field(type, '<>3__' + parameter.name, parameter.type) : null,
    });
  }
  machine.instanceConstructor = synthesizedMethod('.ctor', CONSTRUCTOR_FLAGS, instance(core.void, [core.int]), ['<>1__state'], program =>
    constructorBody(program, machine),
  );
  methods.push(machine.instanceConstructor);
  machine.moveNext = implement('MoveNext', nothing, [slot(stateMachine, 'MoveNext', nothing)], moveNextBody);
  const setStateMachine = instance(core.void, [stateMachine]);
  implement('SetStateMachine', setStateMachine, [slot(stateMachine, 'SetStateMachine', setStateMachine)], () => done(new IlBuilder()), {
    parameterNames: ['stateMachine'],
  });
  implement('MoveNextAsync', instance(answer), [slot(shape.enumerator, 'MoveNextAsync', instance(answer))], moveNextAsyncBody);
  const currentSlot = slot(shape.enumerator, 'get_Current', instance(core.iasyncEnumeratorT.typeParameters[0]));
  implement('get_Current', instance(shape.elementType), [currentSlot], currentBody, { flags: GETTER_FLAGS });
  implement('DisposeAsync', instance(core.valueTask), [slot(core.iasyncDisposable, 'DisposeAsync', instance(core.valueTask))], disposeAsyncBody);
  const typedResult = [slot(types.typedSource, 'GetResult', byToken(sourceResult))],
    untypedResult = [slot(types.source, 'GetResult', byToken(core.void))],
    bothStatus = [slot(types.typedSource, 'GetStatus', byToken(types.status)), slot(types.source, 'GetStatus', byToken(types.status))],
    bothCompleted = [types.typedSource, types.source].map(owner => slot(owner, 'OnCompleted', instance(core.void, onCompleted)));
  implement('GetResult', byToken(core.bool), typedResult, forwardToPromise('GetResult', promiseResult, [core.short]), token);
  implement(SOURCES_PREFIX + 'GetResult', byToken(core.void), untypedResult, forwardToPromise('GetResult', promiseResult, [core.short], true), token);
  implement('GetStatus', byToken(types.status), bothStatus, forwardToPromise('GetStatus', types.status, [core.short]), token);
  implement('OnCompleted', instance(core.void, onCompleted), bothCompleted, forwardToPromise('OnCompleted', core.void, onCompleted), {
    parameterNames: ['continuation', 'state', 'token', 'flags'],
  });
  if (!shape.isEnumerable) return;
  const declared = instance(core.iasyncEnumeratorT.construct(core.iasyncEnumerableT.typeParameters[0]), [types.cancellationToken]);
  const enumerableSlot = [slot(shape.enumerable, 'GetAsyncEnumerator', declared)];
  implement('GetAsyncEnumerator', instance(shape.enumerator, [types.cancellationToken]), enumerableSlot, getAsyncEnumeratorBody, {
    parameterNames: ['cancellationToken'],
  });
}
