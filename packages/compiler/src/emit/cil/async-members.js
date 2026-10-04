/**
 * The class of an async method (SF-A02-T30), in the shape Roslyn gives it in a debug build:
 *
 *   sealed class <M>d__N : IAsyncStateMachine
 *     <>1__state      -1 running or not started, n >= 0 suspended at the n-th await, -2 finished
 *     <>t__builder    the method builder that owns the task (async-builders.js)
 *     p, <>4__this    the parameters and the object the method ran on
 *     <>u__k          an awaiter that is waited for (added while MoveNext is emitted)
 *     MoveNext        the body (emit-async.js)
 *     SetStateMachine nothing: only a struct machine has to be told where its boxed copy is
 *
 * It also declares the entry point of a program whose `Main` is async: `<Main>` runs `Main` and waits for its task.
 */
import { MethodAttributes } from '@sharpforge/cil';
import { IlBuilder } from './il-builder.js';
import { MethodEmitter } from './method-emitter.js';
import { synthesizedMethod } from './synthesized-types.js';

const IMPLEMENTATION_FLAGS =
  MethodAttributes.Private | MethodAttributes.Final | MethodAttributes.HideBySig | MethodAttributes.NewSlot | MethodAttributes.Virtual;
const ENTRY_FLAGS = MethodAttributes.Private | MethodAttributes.Static | MethodAttributes.HideBySig | MethodAttributes.SpecialName;
const STATE_MACHINE_INTERFACE = 'System_Runtime_CompilerServices_IAsyncStateMachine';

const instance = (returnType, parameters = []) => ({ isStatic: false, returnType, parameters: parameters.map(type => ({ type })) });

/** The interface every async state machine implements. */
export function asyncStateMachineInterface(core) {
  return core.bridge.coreType(STATE_MACHINE_INTERFACE);
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
  return emitter.asyncMoveNext(kickoff.body);
}

/**
 * Declares the fields and methods of an async state machine class.
 * @param plan the StateMachinePlan  @param machine the StateMachine being planned (its class has a default
 *   constructor)  @param builder `asyncBuilderOf` of the kickoff's return type
 */
export function declareAsync(plan, machine, builder) {
  const core = plan.core,
    type = machine.type,
    methods = plan.additionsTo(type).methods,
    contract = asyncStateMachineInterface(core),
    implement = (name, parameters, parameterNames, emitBody) => {
      const method = synthesizedMethod(name, IMPLEMENTATION_FLAGS, instance(core.void, parameters), parameterNames, emitBody);
      method.interfaceSlots = [{ owner: contract, name, shape: instance(core.void, parameters) }];
      methods.push(method);
      return method;
    };
  machine.builder = builder;
  machine.fields.builder = plan.field(type, '<>t__builder', builder.builderType);
  for (const parameter of machine.kickoff.parameters) machine.parameters.set(parameter, { field: plan.field(type, parameter.name, parameter.type), initial: null });
  machine.moveNext = implement('MoveNext', [], [], program => moveNextBody(program, machine));
  implement('SetStateMachine', [contract], ['stateMachine'], () => new IlBuilder().emit('ret', undefined, { pops: 0, pushes: 0 }));
}

/**
 * The entry point of a program whose `Main` returns a task: `void <Main>()` or `int <Main>()`, optionally taking
 * `string[]`, which calls `Main` and blocks on `GetAwaiter().GetResult()`.
 * @param core the CoreTypes  @param {{isStatic: true, returnType, parameters: {type}[]}} shape the signature of `Main`
 * @param {(program) => number} tokenOfMain the MethodDef token of `Main`, once tokens are allocated
 */
export function asyncEntryPoint(core, shape, tokenOfMain) {
  const taskType = shape.returnType,
    isGeneric = (taskType.originalDefinition ?? taskType) === core.taskT,
    resultType = isGeneric ? taskType.typeArguments[0].type : core.void,
    awaiterType = isGeneric ? core.taskAwaiterT.construct(resultType) : core.taskAwaiter,
    declaredAwaiter = isGeneric ? core.taskAwaiterT.construct(core.taskT.typeParameters[0]) : core.taskAwaiter,
    declaredResult = isGeneric ? core.taskAwaiterT.typeParameters[0] : core.void,
    entryShape = { isStatic: true, returnType: resultType, parameters: shape.parameters };
  return synthesizedMethod('<Main>', ENTRY_FLAGS, entryShape, shape.parameters.map(() => 'args'), program => {
    const il = new IlBuilder(),
      tokens = program.tokens,
      awaiter = il.declareLocal(awaiterType);
    shape.parameters.forEach((_, index) => il.emit('ldarg', index));
    il.emit('call', tokenOfMain(program), { pops: shape.parameters.length, pushes: 1 });
    il.emit('callvirt', tokens.external(taskType, 'GetAwaiter', instance(declaredAwaiter)), { pops: 1, pushes: 1 });
    il.emit('stloc', awaiter).emit('ldloca', awaiter);
    il.emit('call', tokens.external(awaiterType, 'GetResult', instance(declaredResult)), { pops: 1, pushes: isGeneric ? 1 : 0 });
    return il.emit('ret', undefined, { pops: isGeneric ? 1 : 0, pushes: 0 });
  });
}
