/**
 * The method builders of async methods (SF-A02-T30): which builder an async return type selects, and the tokens of
 * the builder members a state machine calls. The builders are framework structs the symbol table does not model, so
 * their members are named by signature (`!0` is the builder's type parameter, `!!n` a method type parameter).
 *
 *   Task          AsyncTaskMethodBuilder            ValueTask       AsyncValueTaskMethodBuilder
 *   Task<T>       AsyncTaskMethodBuilder<T>         ValueTask<T>    AsyncValueTaskMethodBuilder<T>
 *   void          AsyncVoidMethodBuilder
 */
import { RefKind, TypeKind } from '../../symbols/types.js';
import { frameworkType, methodTypeParameter } from './framework-types.js';

const COMPILER_SERVICES = 'System.Runtime.CompilerServices';
const struct = { typeKind: TypeKind.Struct };
const sameDefinition = (type, definition) => !!type && !!definition && (type.originalDefinition ?? type) === definition;

/**
 * The builder of an async method by its return type, or null for a type no builder is known for.
 * @returns {{builderType, resultType, taskType}|null} `resultType` is null for a method without a result, `taskType`
 *   for `async void`
 */
export function asyncBuilderOf(returnType, core) {
  const builder = (name, arity) => frameworkType(core, COMPILER_SERVICES, name, { ...struct, arity }),
    resultOf = () => returnType.typeArguments[0].type;
  if (returnType?.specialType === 'System_Void') return { builderType: builder('AsyncVoidMethodBuilder', 0), resultType: null, taskType: null };
  if (sameDefinition(returnType, core.task)) return { builderType: builder('AsyncTaskMethodBuilder', 0), resultType: null, taskType: returnType };
  if (sameDefinition(returnType, core.valueTask)) {
    return { builderType: builder('AsyncValueTaskMethodBuilder', 0), resultType: null, taskType: returnType };
  }
  if (sameDefinition(returnType, core.taskT)) {
    return { builderType: builder('AsyncTaskMethodBuilder', 1).construct(resultOf()), resultType: resultOf(), taskType: returnType };
  }
  if (sameDefinition(returnType, core.valueTaskT)) {
    return { builderType: builder('AsyncValueTaskMethodBuilder', 1).construct(resultOf()), resultType: resultOf(), taskType: returnType };
  }
  return null;
}

/** The members of one builder type, as call instructions on an instruction stream. */
export class AsyncBuilderMembers {
  /**
   * @param program the AssemblyEmitter  @param machine a StateMachine of kind 'async' (`builder` is what
   *   `asyncBuilderOf` returned for its kickoff)
   */
  constructor(program, machine) {
    this.program = program;
    this.core = program.core;
    this.machine = machine;
    this.builderType = machine.builder.builderType;
    this.definition = this.builderType.originalDefinition ?? this.builderType;
  }
  token(name, shape) {
    return this.program.tokens.external(this.builderType, name, shape);
  }
  /** `static Builder Create()` */
  create(il) {
    const shape = { isStatic: true, returnType: this.definition, parameters: [] };
    return il.emit('call', this.token('Create', shape), { pops: 0, pushes: 1 });
  }
  /** `void Start<TStateMachine>(ref TStateMachine)`; the builder address and the machine address are on the stack. */
  start(il) {
    const shape = {
      isStatic: false,
      arity: 1,
      returnType: this.core.void,
      parameters: [{ type: methodTypeParameter(0), refKind: RefKind.Ref }],
    };
    return il.emit('call', this.program.tokens.externalGeneric(this.builderType, 'Start', shape, [this.machine.type]), { pops: 2, pushes: 0 });
  }
  /** `Task get_Task()`: the task type over the builder's own type parameter. */
  task(il) {
    const { taskType } = this.machine.builder,
      definition = taskType.originalDefinition ?? taskType,
      returnType = this.definition.arity ? definition.construct(this.definition.typeParameters[0]) : taskType;
    return il.emit('call', this.token('get_Task', { isStatic: false, returnType, parameters: [] }), { pops: 1, pushes: 1 });
  }
  /** `void SetResult()` or `void SetResult(T)` */
  setResult(il) {
    const parameters = this.definition.arity ? [{ type: this.definition.typeParameters[0] }] : [];
    return il.emit('call', this.token('SetResult', { isStatic: false, returnType: this.core.void, parameters }), {
      pops: 1 + parameters.length,
      pushes: 0,
    });
  }
  /** `void SetException(Exception)` */
  setException(il) {
    const shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: this.core.exception }] };
    return il.emit('call', this.token('SetException', shape), { pops: 2, pushes: 0 });
  }
  /**
   * `void AwaitUnsafeOnCompleted<TAwaiter, TStateMachine>(ref TAwaiter, ref TStateMachine)`, or `AwaitOnCompleted`
   * for an awaiter that only implements `INotifyCompletion`.
   */
  awaitOnCompleted(il, awaiterType, isCritical) {
    const byReference = ordinal => ({ type: methodTypeParameter(ordinal), refKind: RefKind.Ref }),
      shape = { isStatic: false, arity: 2, returnType: this.core.void, parameters: [byReference(0), byReference(1)] },
      name = isCritical ? 'AwaitUnsafeOnCompleted' : 'AwaitOnCompleted',
      token = this.program.tokens.externalGeneric(this.builderType, name, shape, [awaiterType, this.machine.type]);
    return il.emit('call', token, { pops: 3, pushes: 0 });
  }
}
