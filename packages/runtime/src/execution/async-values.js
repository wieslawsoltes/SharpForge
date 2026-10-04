import {asyncStateMachine, asyncTypeDefinition, asyncValueType, asyncTypes} from '@sharpforge/cil';
import {ManagedFault} from './managed-fault.js';
import {createValue, createValueFromFields} from './value-types.js';
import {verifiedMethod} from './token-cache.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function abiValue(vm, table) {
  if (!table.flags.runtimeValue || vm.typeSystem?.types?.has(table.definitionToken)) return null;
  return asyncTypeDefinition(table.genericDefinition?.name ?? table.name)?.flags?.runtimeValue
    ? asyncValueType(table.name) ?? {kind: 'builder', element: null} : null;
}

/** ABI identity and verified callbacks supplement, never replace, ordinary managed-value admission. */
export function isAsyncValue(vm, table) {
  if (table?.registry !== vm.heap.methodTables || !table.flags.valueType || table.containsGenericParameters) return false;
  if (abiValue(vm, table)) return true;
  const machine = vm.inspector && asyncStateMachine(vm.inspector, table.name);
  return !!machine && !!verifiedMethod(vm, machine.moveNext) && !!verifiedMethod(vm, machine.setStateMachine);
}

function requireAsyncValue(vm, table) {
  if (!isAsyncValue(vm, table)) invalid('Async value storage requires a closed admitted type from this VM');
}

function taskPayload(vm, table, task) {
  const definition = abiValue(vm, table);
  if (!definition || table.fields.length !== 1 || table.fields[0].name !== '$task') {
    invalid('Async infrastructure requires its canonical Task slot');
  }
  if (task === null) return;
  vm.scheduler.taskRecord(task);
  const name = definition.element === null ? asyncTypes.task : asyncTypes.task + '`1<' + definition.element + '>';
  if (!vm.typeSystem.castCache.isAssignableFrom(vm.typeSystem.table(name), vm.heap.get(task).methodTable)) {
    invalid('Async value Task payload has an incompatible result type');
  }
}

/** Default and copy operations share aggregate layout, ownership, field budgets, and snapshot representation. */
export function asyncValue(vm, table, source = null) {
  requireAsyncValue(vm, table);
  const result = createValue(vm, table, source);
  if (abiValue(vm, table)) taskPayload(vm, table, result.fields[0]);
  return result;
}

/** Builders, awaiters, and Yield values retain the same single managed-reference slot. */
export function asyncTaskValue(vm, type, task = null) {
  const table = vm.typeSystem.table(type);
  requireAsyncValue(vm, table);
  taskPayload(vm, table, task);
  return createValueFromFields(vm, table, [task]);
}

/** Copying a declared value slot cannot turn null into its default value. */
export function copyAsyncValue(vm, table, source) {
  if (source === null || source === undefined) invalid('Async value storage requires a value, not null');
  return asyncValue(vm, table, source);
}
