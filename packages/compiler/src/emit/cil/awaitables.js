/**
 * What `await e` calls (SF-A02-T30): `e.GetAwaiter()`, then `IsCompleted` and `GetResult()` of the awaiter.
 *
 *   Task, Task<T>             TaskAwaiter, TaskAwaiter<T>
 *   ValueTask, ValueTask<T>   ValueTaskAwaiter, ValueTaskAwaiter<T>
 *   Task.Yield()              YieldAwaitable and its nested YieldAwaiter
 *   anything else             the awaitable pattern the binder resolved (binder/await.js)
 *
 * The symbol table types `Task.Yield()` as `Task` and lists no awaiter for the task types, so those members are
 * named by signature here; .NET resolves a member by its exact signature.
 */
import { TypeKind } from '../../symbols/types.js';
import { implementsInterface } from '../../symbols/substitution.js';
import { frameworkType } from './framework-types.js';
import { isVoid } from './type-facts.js';

const COMPILER_SERVICES = 'System.Runtime.CompilerServices';
const struct = { typeKind: TypeKind.Struct };
const sameDefinition = (type, definition) => !!type && !!definition && (type.originalDefinition ?? type) === definition;
const instance = (returnType, parameters = []) => ({ isStatic: false, returnType, parameters });

/** True for the call `Task.Yield()`. */
function isTaskYield(node, core) {
  const method = node.kind === 'Call' ? node.method : null;
  return !!method?.isStatic && method.name === 'Yield' && !method.parameters.length && sameDefinition(method.containingType, core.task);
}

/**
 * An awaiter whose members are named by signature.
 * @param {{awaiterType, resultType, pushAwaiter: () => void}} shape `resultType` is the declared result of
 *   `GetResult` (`!0` for a generic awaiter); `pushAwaiter` evaluates the operand and calls `GetAwaiter`
 */
function frameworkAwaiter(emitter, { awaiterType, resultType, pushAwaiter }) {
  const { il, tokens, core } = emitter;
  return {
    awaiterType,
    isCritical: true,
    getAwaiter: pushAwaiter,
    isCompleted: () => il.emit('call', tokens.external(awaiterType, 'get_IsCompleted', instance(core.bool)), { pops: 1, pushes: 1 }),
    getResult: () => il.emit('call', tokens.external(awaiterType, 'GetResult', instance(resultType)), { pops: 1, pushes: isVoid(resultType) ? 0 : 1 }),
  };
}

/** `Task` and `Task<T>`: `callvirt GetAwaiter` on the reference. */
function taskAwaiter(emitter, operand) {
  const { il, tokens, core } = emitter,
    type = operand.type,
    isGeneric = sameDefinition(type, core.taskT),
    awaiterType = isGeneric ? core.taskAwaiterT.construct(type.typeArguments[0].type) : core.taskAwaiter,
    declared = isGeneric ? core.taskAwaiterT.construct(core.taskT.typeParameters[0]) : core.taskAwaiter;
  return frameworkAwaiter(emitter, {
    awaiterType,
    resultType: isGeneric ? core.taskAwaiterT.typeParameters[0] : core.void,
    pushAwaiter: () => {
      emitter.expression(operand);
      il.emit('callvirt', tokens.external(type, 'GetAwaiter', instance(declared)), { pops: 1, pushes: 1 });
    },
  });
}

/** `ValueTask` and `ValueTask<T>` are structs: `GetAwaiter` is called on the address of the value. */
function valueTaskAwaiter(emitter, operand) {
  const { il, tokens, core } = emitter,
    type = operand.type,
    isGeneric = sameDefinition(type, core.valueTaskT),
    definition = frameworkType(core, COMPILER_SERVICES, 'ValueTaskAwaiter', { ...struct, arity: isGeneric ? 1 : 0 }),
    awaiterType = isGeneric ? definition.construct(type.typeArguments[0].type) : definition,
    declared = isGeneric ? definition.construct(core.valueTaskT.typeParameters[0]) : definition;
  return frameworkAwaiter(emitter, {
    awaiterType,
    resultType: isGeneric ? definition.typeParameters[0] : core.void,
    pushAwaiter: () => {
      emitter.address(operand);
      il.emit('call', tokens.external(type, 'GetAwaiter', instance(declared)), { pops: 1, pushes: 1 });
    },
  });
}

function yieldAwaiter(emitter) {
  const { il, tokens, core } = emitter,
    awaitable = frameworkType(core, COMPILER_SERVICES, 'YieldAwaitable', struct),
    awaiterType = frameworkType(core, COMPILER_SERVICES, 'YieldAwaiter', { ...struct, outer: awaitable });
  return frameworkAwaiter(emitter, {
    awaiterType,
    resultType: core.void,
    pushAwaiter: () => {
      const slot = emitter.temp(awaitable);
      il.emit('call', tokens.external(core.task, 'Yield', { isStatic: true, returnType: awaitable, parameters: [] }), { pops: 0, pushes: 1 });
      il.emit('stloc', slot).emit('ldloca', slot);
      il.emit('call', tokens.external(awaitable, 'GetAwaiter', instance(awaiterType)), { pops: 1, pushes: 1 });
    },
  });
}

/** The awaitable pattern: the members the binder found, called as any other member. */
function patternAwaiter(emitter, node) {
  const { core } = emitter,
    { getAwaiter, isCompleted, getResult, isExtension } = node.awaitable,
    awaiterType = getAwaiter.returnType,
    receiver = { kind: 'Temporary', type: awaiterType },
    completedGetter = isCompleted?.getMethod ?? isCompleted;
  if (!completedGetter || !getResult) return emitter.unsupported('this awaitable', node.syntax);
  return {
    awaiterType,
    isCritical: !!core.icriticalNotifyCompletion && implementsInterface(awaiterType, core.icriticalNotifyCompletion, core),
    getAwaiter: () => {
      if (isExtension || getAwaiter.isStatic) {
        emitter.expression(node.operand);
        return emitter.callMethod(getAwaiter, { syntax: node.syntax });
      }
      emitter.receiver(node.operand);
      return emitter.callMethod(getAwaiter, { receiver: node.operand, syntax: node.syntax });
    },
    isCompleted: () => emitter.callMethod(completedGetter, { receiver, syntax: node.syntax }),
    getResult: () => emitter.callMethod(getResult, { receiver, syntax: node.syntax }),
  };
}

/**
 * The awaiter of a bound `Await` node.
 * @returns {{awaiterType, isCritical: boolean, getAwaiter: () => void, isCompleted: () => void, getResult: () => void}}
 *   `getAwaiter` evaluates the operand and leaves the awaiter on the stack; the other two take the awaiter (its
 *   address for a struct) from the stack. `isCritical`: the awaiter implements `ICriticalNotifyCompletion`.
 */
export function awaiterOf(emitter, node) {
  const core = emitter.core,
    operand = node.operand,
    type = operand.type;
  if (node.isDynamic) return emitter.unsupported('await of a dynamic value', node.syntax);
  if (node.awaitable) return patternAwaiter(emitter, node);
  if (isTaskYield(operand, core)) return yieldAwaiter(emitter);
  if (sameDefinition(type, core.task) || sameDefinition(type, core.taskT)) return taskAwaiter(emitter, operand);
  if (sameDefinition(type, core.valueTask) || sameDefinition(type, core.valueTaskT)) return valueTaskAwaiter(emitter, operand);
  return emitter.unsupported(`await of '${type?.toDisplayString()}'`, node.syntax);
}
