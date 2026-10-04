import {NullableValueStep} from './nullable-interior.js';
import {snapshotAddress} from './snapshot-address-validation.js';
import {
  genericTypeParts,
  normalizeCallType
} from '@sharpforge/cil';
import {
  isReference
} from '../heap.js';

const C = 'System.Runtime.CompilerServices.',
  TASK = 'System.Threading.Tasks.Task';
const terminal = new Set(['completed', 'faulted', 'canceled']);
const phases = new Set(['created', 'running', 'awaiting', 'completed', 'faulted']);
const fields = new Set(['kind', 'builderType', 'machine', 'moveNext', 'contextId', 'awaitedTask', 'phase']);
const key = reference => reference.h + ':' + reference.g;
const same = (a, b) => isReference(a) && isReference(b) && a.h === b.h && a.g === b.g;

/** Read the snapshot graph only. Never consult live heap records, resume a
 * scheduler, or materialize MethodTables while deciding whether restore is safe. */
export function validateAsyncSnapshot(vm, snapshot) {
  const fail = part => {
    throw new TypeError('Invalid snapshot async ' + part);
  };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const scheduler = snapshot.scheduler,
    contexts = new Map(scheduler?.contexts ?? []),
    tasks = new Map(),
    frames = new Map();
  for (const frame of snapshot.frames ?? []) frames.set(frame.id, frame);
  for (const [, context] of contexts)
    for (const frame of context.frames) frames.set(frame.id, frame);
  const reference = (value, live = true) => {
    if (!isReference(value) || !integer(value.h) || !integer(value.g) || value.g === 0 || value.heapOwner !== undefined && value.heapOwner !== vm
      .heap.handleOwner) fail('reference ownership');
    const record = snapshot.heap.generations[value.h] === value.g ? snapshot.heap.records[value.h] : null;
    if (live && !record) fail('reference lifetime');
    return record ?? null;
  };
  const property = (record, name) => {
    if (record.kind !== 'task' || !Array.isArray(record.data) || record.data.length % 2) fail('task heap record');
    let found = false,
      value;
    for (let index = 0; index < record.data.length; index += 2)
      if (record.data[index] === name) {
        if (found) fail('duplicate task property');
        found = true;
        value = record.data[index + 1];
      }
    if (!found) fail('missing task property');
    return value;
  };
  for (const [, task] of scheduler?.tasks ?? []) tasks.set(key(task.ref), task);
  const taskFor = (value, live = true) => {
    const record = reference(value, live),
      task = tasks.get(key(value));
    if (!task) fail('task identity');
    if (record && (property(record, 'Id') !== task.id || property(record, '$status') !== task.status)) fail('task heap identity');
    return task;
  };
  const method = token => {
    if (!vm.inspector || !Number.isInteger(token) || !vm.report.methods.includes(token)) fail('unverified MoveNext');
    // Reachability verification already decoded this body; this read creates no
    // execution state and never resolves a type against the live call frame.
    const body = vm.inspector.getMethod(token),
      signature = body.signature;
    if (signature.isStatic || signature.parameters.length || signature.returnType !== 'void' || signature.genericArity) fail('MoveNext signature');
    return body;
  };
  const machineValue = (value, live, depth = 0) => {
    if (depth > 128) fail('machine value nesting');
    if (isReference(value)) {
      reference(value, live);
      return;
    }
    if (value?.byref) fail('machine value address escape');
    if (value?.methodPointer && value.vmOwner !== vm.snapshotOwner) fail('machine function pointer ownership');
    if (value?.valueType) {
      const table = value.valueType;
      if (table.registry !== vm.heap.methodTables || vm.heap.methodTables.tables.get(table.name) !== table || !Object.isFrozen(value) || !Array
        .isArray(value.fields) || !Object.isFrozen(value.fields) || value.fields.length !== table.fields.length) fail('machine value');
      for (const field of value.fields) machineValue(field, live, depth + 1);
    }
  };
  const machine = (value, moveNext, live = true) => {
    const record = reference(value, live);
    if (!record) return null;
    const table = record.methodTable;
    if (table?.registry !== vm.heap.methodTables || vm.heap.methodTables.tables.get(table.name) !== table || ![...table.interfaceMap.keys()].some(
        type => type.name === C + 'IAsyncStateMachine')) fail('machine type');
    if (table.flags.valueType) {
      const value = record.data[0];
      if (record.kind !== 'box' || record.data.length !== 1 || value?.valueType !== table || !Object.isFrozen(value) || !Array.isArray(value
        .fields) || !Object.isFrozen(value.fields) || value.fields.length !== table.fields.length) fail('machine box');
    } else if (record.kind !== 'object' || record.data.length !== table.fields.length) fail('machine object');
    for (const value of record.data) machineValue(value, live);
    const body = method(moveNext);
    if (![...table.vtable.values()].includes(moveNext) && !(body.ownerToken === table.definitionToken && body.name === 'MoveNext')) fail(
      'machine method');
    return record;
  };
  const receiver = (frame, expected = null) => {
    let value = frame.args[0];
    if (value?.byref) {
      const pointer = value;
      if (pointer.vmOwner !== vm.snapshotOwner || !Object.isFrozen(pointer) || !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) ||
        pointer.readonly || !(integer(pointer.index) || pointer.kind === 'static' && typeof pointer.index === 'string') || pointer.baseType !==
        undefined && pointer.baseType !== null && pointer.baseType?.registry !== vm.heap.methodTables) fail('machine address');
      if (['arg', 'local'].includes(pointer.kind)) {
        const owner = frames.get(pointer.frameId),
          slots = pointer.kind === 'arg' ? owner?.args : owner?.locals;
        if (!slots || pointer.index >= slots.length) fail('machine address lifetime');
        value = slots[pointer.index];
      } else if (pointer.kind === 'static') {
        if (!(snapshot.statics instanceof Map) || !snapshot.statics.has(pointer.index)) fail('machine static address');
        value = snapshot.statics.get(pointer.index);
      } else if (['box', 'field', 'array'].includes(pointer.kind)) {
        const record = reference(pointer.owner);
        if (!Array.isArray(record.data) || pointer.index >= record.data.length || pointer.kind === 'box' && (record.kind !== 'box' || pointer
            .index !== 0) || pointer.kind === 'array' && record.kind !== 'array' || pointer.kind === 'field' && ['box', 'array', 'string'].includes(
            record.kind)) fail('machine heap address');
        value = record.data[pointer.index];
      } else fail('machine address kind');
      for (const index of pointer.path) {
        if (index === NullableValueStep) {
          const location = snapshotAddress({vm, snapshot, frames, referenceRecord: reference, metadataVM: vm}, pointer);
          if (location.readonly || location.onePast) fail('machine nullable address');
          value = location.value;
          break;
        }
        if (!integer(index) || !Array.isArray(value?.fields) || index >= value.fields.length) fail('machine interior address');
        value = value.fields[index];
      }
      if (expected && (pointer.kind !== 'box' || pointer.path.length || !same(pointer.owner, expected))) fail('continuation machine address');
    } else if (expected && !same(value, expected)) fail('continuation machine receiver');
    const table = isReference(value) ? reference(value).methodTable : value?.valueType;
    if (!table || table.registry !== vm.heap.methodTables || vm.heap.methodTables.tables.get(table.name) !== table || ![...table.interfaceMap
      .keys()].some(type => type.name === C + 'IAsyncStateMachine')) fail('frame machine type');
    if (table.flags.valueType && !frame.args[0]?.byref) fail('value machine receiver');
    if (table.flags.valueType && (!Object.isFrozen(value) || !Array.isArray(value.fields) || !Object.isFrozen(value.fields) || value.fields
        .length !== table.fields.length)) fail('frame machine value');
    if (frame.genericIdentity !== undefined && frame.genericIdentity !== null && normalizeCallType(frame.genericIdentity) !== normalizeCallType(
        table.name)) fail('frame machine instantiation');
    machineValue(value, true);
    if (![...table.vtable.values()].includes(frame.method.token) && !(frame.method.ownerToken === table.definitionToken && frame.method.name ===
        'MoveNext')) fail('frame machine method');
  };
  for (const task of tasks.values()) {
    if (task.asyncState === undefined) continue;
    const state = task.asyncState,
      isTerminal = terminal.has(task.status);
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).some(name => !fields.has(name)) || [...fields].some(name =>
        !Object.hasOwn(state, name)) || !phases.has(state.phase) || !['task', 'void'].includes(state.kind) || typeof state.builderType !== 'string')
      fail('builder state');
    const parts = genericTypeParts(state.builderType),
      generic = parts.definition === C + 'AsyncTaskMethodBuilder`1',
      voidBuilder = parts.definition === C + 'AsyncVoidMethodBuilder';
    if (!generic && !voidBuilder && parts.definition !== C + 'AsyncTaskMethodBuilder' || parts.arguments.length !== (generic ? 1 : 0) || /!!?\d+/
      .test(state.builderType) || state.kind !== (voidBuilder ? 'void' : 'task')) fail('builder type');
    const resultType = generic ? parts.arguments[0] : 'void';
    if (typeof task.resultType !== 'string' || normalizeCallType(task.resultType) !== normalizeCallType(resultType)) fail('builder result type');
    const record = reference(task.ref, !isTerminal);
    taskFor(task.ref, !isTerminal);
    if (record && normalizeCallType(record.methodTable.name) !== normalizeCallType(resultType === 'void' ? TASK : TASK + '`1<' + resultType + '>'))
      fail('builder task type');
    if (state.moveNext !== null) method(state.moveNext);
    if (state.contextId !== null && (!integer(state.contextId) || state.contextId === 0 || state.contextId >= scheduler.nextId)) fail(
      'continuation context identity');
    if (state.machine !== null) machine(state.machine, state.moveNext, !isTerminal);
    if (state.awaitedTask !== null) {
      reference(state.awaitedTask, !isTerminal);
      if (!isTerminal) taskFor(state.awaitedTask);
    }
    // Cancellation can leave a historical awaiting state, and completed rows can
    // outlive collection of their heap records or pruning of their contexts.
    if (isTerminal) continue;
    if (!['created', 'running', 'awaiting'].includes(state.phase)) fail('pending builder phase');
    if ((task.contextId ?? null) !== state.contextId) fail('builder context identity');
    if (state.phase === 'created') {
      if (state.moveNext !== null || state.machine !== null || state.contextId !== null || state.awaitedTask !== null) fail('created builder state');
      continue;
    }
    if (state.moveNext === null) fail('missing MoveNext');
    if (state.phase === 'running' && state.awaitedTask !== null) fail('running await dependency');
    if (state.contextId !== null) {
      const context = contexts.get(state.contextId);
      if (!context || terminal.has(context.status) || context.kind !== 'async-state-machine' || task.contextId !== state.contextId) fail(
        'continuation context');
      const frame = context.frames.find(frame => same(frame.asyncBuilderTask, task.ref) && frame.method.token === state.moveNext);
      if (!frame || state.machine === null) fail('continuation frame');
      receiver(frame, state.machine);
    }
    if (state.phase === 'awaiting') {
      if (state.machine === null || state.contextId === null || state.awaitedTask === null || same(task.ref, state.awaitedTask)) fail('await state');
      const context = contexts.get(state.contextId),
        awaited = taskFor(state.awaitedTask);
      if (context.wait) {
        if (context.status !== 'waiting' || !same(context.wait.task, state.awaitedTask) || context.wait.pushResult !== false || context.wait
          .propagateFault !== false || !awaited.waiters.includes(context.id)) fail('await context wait');
      } else if (!terminal.has(awaited.status) || !['ready', 'running'].includes(context.status)) fail('ready await context');
    }
  }
  for (const frame of frames.values())
    if (frame.asyncBuilderTask !== undefined) {
      const task = taskFor(frame.asyncBuilderTask),
        state = task.asyncState;
      if (!state || frame.method.token !== state.moveNext) fail('frame builder task');
      method(frame.method.token);
      receiver(frame);
    }
  if (scheduler?.unhandledFault?.reference) reference(scheduler.unhandledFault.reference);
  return snapshot;
}
