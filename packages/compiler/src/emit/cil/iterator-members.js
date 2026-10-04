/**
 * The class of an iterator (SF-A02-T30), in the shape Roslyn gives it:
 *
 *   sealed class <M>d__N : IEnumerable<T>, IEnumerable, IEnumerator<T>, IEnumerator, IDisposable
 *     <>1__state              -2 an enumerable nobody enumerates (and a disposed enumerator), 0 before the first
 *                             MoveNext, -1 running, n > 0 suspended at the n-th `yield return`
 *     <>2__current            the value of the last `yield return`
 *     <>l__initialThreadId    the thread that created an enumerable: its first GetEnumerator on that thread returns
 *                             the object itself, any other call a new one
 *     p, <>3__p               a parameter, and the value an enumerable hands to each of its enumerators
 *     <>w__disposeMode        set by Dispose: the next MoveNext only runs the finally blocks that are pending
 *
 * An iterator that returns `IEnumerator` or `IEnumerator<T>` has no enumerable half. `MoveNext` is emitted from the
 * body (emit-iterators.js); the other members are fixed and written here.
 */
import { MethodAttributes, FieldAttributes } from '@sharpforge/cil';
import { walk } from '../../bound/semantic-walker.js';
import { IlBuilder } from './il-builder.js';
import { MethodEmitter } from './method-emitter.js';
import { CONSTRUCTOR_FLAGS, callObjectConstructor, synthesizedMethod } from './synthesized-types.js';
import { frameworkType } from './framework-types.js';
import { needsBox } from './type-facts.js';

const IMPLEMENTATION_FLAGS =
  MethodAttributes.Private | MethodAttributes.Final | MethodAttributes.HideBySig | MethodAttributes.NewSlot | MethodAttributes.Virtual;
const GETTER_FLAGS = IMPLEMENTATION_FLAGS | MethodAttributes.SpecialName;
const NOT_ENUMERATING = -2;
const BEFORE_FIRST = 0;
/** Statements that protect their body with a finally block: a `yield return` inside one needs Dispose to run it. */
const protectingStatements = new Set(['Try', 'Using', 'ForEach', 'Lock']);
const nestedFunctions = new Set(['Lambda', 'LocalFunction']);

const sameDefinition = (type, definition) => !!type && (type.originalDefinition ?? type) === definition;
const done = il => il.emit('ret', undefined, { pops: 0, pushes: 0 });
const returned = il => il.emit('ret', undefined, { pops: 1, pushes: 0 });

/**
 * What an iterator's return type makes of it, or null for a type an iterator cannot return.
 * @returns {{elementType, isEnumerable: boolean, interfaces: object[], enumerable, enumerator}|null}
 */
export function iteratorShapeOf(returnType, core) {
  const isGeneric = sameDefinition(returnType, core.ienumerableT) || sameDefinition(returnType, core.ienumeratorT),
    isEnumerable = sameDefinition(returnType, core.ienumerableT) || sameDefinition(returnType, core.ienumerable);
  if (!isGeneric && !isEnumerable && !sameDefinition(returnType, core.ienumerator)) return null;
  const elementType = isGeneric ? returnType.typeArguments[0].type : core.object,
    enumerable = core.ienumerableT.construct(elementType),
    enumerator = core.ienumeratorT.construct(elementType),
    enumeratorHalf = [enumerator, core.ienumerator, core.idisposable];
  return { elementType, isEnumerable, enumerable, enumerator, interfaces: isEnumerable ? [enumerable, core.ienumerable, ...enumeratorHalf] : enumeratorHalf };
}

/** True when a `yield return` may sit inside a protected region, so that Dispose has a finally block to run. */
function yieldsUnderProtection(body) {
  let yields = false,
    protects = false;
  walk(body, node => {
    if (node.kind === 'YieldReturn') yields = true;
    if (protectingStatements.has(node.kind) || (node.kind === 'LocalDeclaration' && node.isUsing)) protects = true;
    return !nestedFunctions.has(node.kind);
  });
  return yields && protects;
}

const instance = (returnType, parameters = []) => ({ isStatic: false, returnType, parameters: parameters.map(type => ({ type })) });

function currentThreadId(program, il) {
  const core = program.core,
    environment = frameworkType(core, 'System', 'Environment'),
    getter = { isStatic: true, returnType: core.int, parameters: [] };
  return il.emit('call', program.tokens.external(environment, 'get_CurrentManagedThreadId', getter), { pops: 0, pushes: 1 });
}

/** `.ctor(int state)`: the state, and for an enumerable the thread that created it. */
function constructorBody(program, machine) {
  const il = callObjectConstructor(program, new IlBuilder());
  il.emit('ldarg', 0).emit('ldarg', 1).emit('stfld', machine.fields.state.token);
  if (machine.fields.initialThreadId) {
    il.emit('ldarg', 0);
    currentThreadId(program, il).emit('stfld', machine.fields.initialThreadId.token);
  }
  return done(il);
}

/**
 * `IDisposable.Dispose`: a suspended enumerator resumes in dispose mode, which runs the finally blocks around the
 * `yield return` it stopped at and nothing else; afterwards the enumerator is finished.
 */
function disposeBody(program, machine) {
  const il = new IlBuilder(),
    { state, disposeMode } = machine.fields;
  if (disposeMode) {
    const finished = il.newLabel();
    il.emit('ldarg', 0).emit('ldfld', state.token).emit('ldc.i4', 0).emit('ble', finished);
    il.emit('ldarg', 0).emit('ldc.i4', 1).emit('stfld', disposeMode.token);
    il.emit('ldarg', 0).emit('call', machine.moveNext.token, { pops: 1, pushes: 1 }).emit('pop');
    il.emit('ldarg', 0).emit('ldc.i4', 0).emit('stfld', disposeMode.token);
    il.mark(finished);
  }
  il.emit('ldarg', 0).emit('ldc.i4', NOT_ENUMERATING).emit('stfld', state.token);
  return done(il);
}

function currentBody(program, machine, boxed) {
  const il = new IlBuilder(),
    current = machine.fields.current;
  il.emit('ldarg', 0).emit('ldfld', current.token);
  if (boxed && needsBox(current.type)) il.emit('box', program.tokens.type(current.type));
  return returned(il);
}

function resetBody(program) {
  const core = program.core,
    notSupported = core.bridge.coreType('System_NotSupportedException'),
    il = new IlBuilder();
  il.emit('newobj', program.tokens.external(notSupported, '.ctor', instance(core.void)), { pops: 0, pushes: 1 });
  return il.emit('throw');
}

/**
 * `IEnumerable<T>.GetEnumerator`: the enumerable itself for the first enumeration on the thread that created it,
 * otherwise a new enumerator; either starts from the parameter values the enumerable was created with.
 */
function getEnumeratorBody(program, machine) {
  const il = new IlBuilder(),
    { state, initialThreadId, receiver } = machine.fields,
    result = il.declareLocal(machine.type),
    create = il.newLabel(),
    copy = il.newLabel();
  il.emit('ldarg', 0).emit('ldfld', state.token).emit('ldc.i4', NOT_ENUMERATING).emit('bne.un', create);
  il.emit('ldarg', 0).emit('ldfld', initialThreadId.token);
  currentThreadId(program, il).emit('bne.un', create);
  il.emit('ldarg', 0).emit('ldc.i4', BEFORE_FIRST).emit('stfld', state.token);
  il.emit('ldarg', 0).emit('stloc', result).emit('br', copy);
  il.mark(create);
  il.emit('ldc.i4', BEFORE_FIRST).emit('newobj', machine.instanceConstructor.token, { pops: 1, pushes: 1 }).emit('stloc', result);
  if (receiver) il.emit('ldloc', result).emit('ldarg', 0).emit('ldfld', receiver.token).emit('stfld', receiver.token);
  il.mark(copy);
  for (const { field, initial } of machine.parameters.values()) {
    il.emit('ldloc', result).emit('ldarg', 0).emit('ldfld', initial.token).emit('stfld', field.token);
  }
  return returned(il.emit('ldloc', result));
}

function forwardingBody(target) {
  const il = new IlBuilder();
  return returned(il.emit('ldarg', 0).emit('call', target.token, { pops: 1, pushes: 1 }));
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
  return emitter.iteratorMoveNext(kickoff.body);
}

/**
 * Declares the fields and methods of an iterator class.
 * @param plan the StateMachinePlan  @param machine the StateMachine being planned  @param shape `iteratorShapeOf`
 */
export function declareIterator(plan, machine, shape) {
  const core = plan.core,
    type = machine.definition,
    kickoff = machine.kickoff,
    methods = plan.additionsTo(type).methods,
    privateField = (name, fieldType) => plan.field(type, name, fieldType, FieldAttributes.Private),
    implement = (name, flags, returnType, overrides, emitBody) => {
      const method = synthesizedMethod(name, flags, instance(returnType), [], program => emitBody(program, machine));
      method.interfaceSlots = overrides;
      methods.push(method);
      return method;
    },
    slot = (owner, name, returnType) => ({ owner, name, shape: instance(returnType) }),
    elementParameter = core.ienumeratorT.typeParameters[0],
    enumeratorOfParameter = core.ienumeratorT.construct(core.ienumerableT.typeParameters[0]),
    // Explicit implementations are named after the interface, as Roslyn names them.
    elementName = shape.elementType.metadataFullName ?? shape.elementType.toDisplayString(),
    typedEnumerator = `System.Collections.Generic.IEnumerator<${elementName}>`,
    typedEnumerable = `System.Collections.Generic.IEnumerable<${elementName}>`;
  machine.shape = shape;
  machine.fields.current = privateField('<>2__current', shape.elementType);
  if (shape.isEnumerable) machine.fields.initialThreadId = privateField('<>l__initialThreadId', core.int);
  if (yieldsUnderProtection(kickoff.body)) machine.fields.disposeMode = privateField('<>w__disposeMode', core.bool);
  for (const parameter of kickoff.parameters) {
    machine.parameters.set(parameter, {
      field: plan.field(type, parameter.name, parameter.type),
      initial: shape.isEnumerable ? plan.field(type, '<>3__' + parameter.name, parameter.type) : null,
    });
  }
  machine.instanceConstructor = synthesizedMethod('.ctor', CONSTRUCTOR_FLAGS, instance(core.void, [core.int]), ['<>1__state'], program =>
    constructorBody(program, machine),
  );
  methods.push(machine.instanceConstructor);
  implement('System.IDisposable.Dispose', IMPLEMENTATION_FLAGS, core.void, [slot(core.idisposable, 'Dispose', core.void)], disposeBody);
  machine.moveNext = implement('MoveNext', IMPLEMENTATION_FLAGS, core.bool, [slot(core.ienumerator, 'MoveNext', core.bool)], moveNextBody);
  const typedCurrent = [slot(shape.enumerator, 'get_Current', elementParameter)];
  implement(typedEnumerator + '.get_Current', GETTER_FLAGS, shape.elementType, typedCurrent, (program, owner) =>
    currentBody(program, owner, false),
  );
  implement('System.Collections.IEnumerator.Reset', IMPLEMENTATION_FLAGS, core.void, [slot(core.ienumerator, 'Reset', core.void)], resetBody);
  implement('System.Collections.IEnumerator.get_Current', GETTER_FLAGS, core.object, [slot(core.ienumerator, 'get_Current', core.object)], (program, owner) =>
    currentBody(program, owner, true),
  );
  if (!shape.isEnumerable) return;
  const typedSlot = [slot(shape.enumerable, 'GetEnumerator', enumeratorOfParameter)],
    typed = implement(typedEnumerable + '.GetEnumerator', IMPLEMENTATION_FLAGS, shape.enumerator, typedSlot, getEnumeratorBody),
    untypedSlot = [slot(core.ienumerable, 'GetEnumerator', core.ienumerator)];
  implement('System.Collections.IEnumerable.GetEnumerator', IMPLEMENTATION_FLAGS, core.ienumerator, untypedSlot, () => forwardingBody(typed));
}
