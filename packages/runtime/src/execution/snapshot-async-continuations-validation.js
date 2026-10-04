import {asyncStateMachine, normalizeCallType} from '@sharpforge/cil';
import {isReference} from './managed-fault.js';
import {validateSnapshotAsyncDelegate} from './snapshot-async-delegate-validation.js';
import {invalidSnapshot, terminalContext} from './snapshot-validation-helpers.js';

const fail = part => invalidSnapshot('async continuation ' + part);
const same = (left, right) => isReference(left) && isReference(right) && left.h === right.h && left.g === right.g;
const key = reference => reference.h + ':' + reference.g;

function shape(value, fields, part) {
  if (!value || !Object.isFrozen(value) || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail(part);
}

function machine(context, continuation, live) {
  shape(continuation, ['kind', 'type', 'method', 'receiver'], 'machine state');
  const {vm, snapshot} = context;
  if (continuation.kind !== 'machine' || !vm.inspector || typeof continuation.type !== 'string' ||
      !Number.isInteger(continuation.method) || !isReference(continuation.receiver)) fail('machine identity');
  let descriptor;
  try {
    descriptor = asyncStateMachine(vm.inspector, continuation.type);
  } catch {
    fail('machine metadata');
  }
  if (!descriptor || descriptor.moveNext !== continuation.method ||
      !vm.report.methods.includes(descriptor.moveNext) || !vm.report.methods.includes(descriptor.setStateMachine)) {
    fail('unverified machine target');
  }
  const reference = continuation.receiver;
  // Historical terminal task payloads are not roots; their issued handles may already have expired.
  if (!live && (snapshot.heap.generations[reference.h] !== reference.g || !snapshot.heap.records[reference.h])) return descriptor;
  const record = context.referenceRecord(reference);
  if (normalizeCallType(record.methodTable.name) !== descriptor.name ||
      record.kind !== (descriptor.valueType ? 'box' : 'object')) fail('machine receiver type');
  if (descriptor.valueType && (record.data.length !== 1 || record.data[0]?.valueType !== record.methodTable)) {
    fail('machine receiver box');
  }
  return descriptor;
}

function continuation(context, value) {
  if (value?.kind === 'machine') return machine(context, value, true);
  shape(value, ['kind', 'receiver'], 'delegate state');
  if (value.kind !== 'delegate') fail('kind');
  validateSnapshotAsyncDelegate(context, value.receiver);
  return null;
}

function registration(context, frame, tasks) {
  const value = frame.asyncRegistration;
  shape(value, ['task', 'continuation'], 'registration');
  const record = context.referenceRecord(value.task);
  const task = tasks.get(key(value.task));
  if (!task || record.kind !== 'task') fail('registration task');
  const descriptor = machine(context, value.continuation, true);
  const receiver = value.continuation.receiver;
  if (!descriptor.valueType || frame.method.token !== descriptor.setStateMachine || frame.args?.length !== 2 ||
      !same(frame.args[1], receiver)) fail('registration callback');
  const address = frame.args[0];
  if (!address?.byref || address.kind !== 'box' || address.index !== 0 || address.readonly ||
      !Array.isArray(address.path) || address.path.length || !same(address.owner, receiver)) fail('registration receiver');
  if (frame.genericIdentity != null && normalizeCallType(frame.genericIdentity) !== descriptor.name) fail('registration instantiation');
}

/** Validate pending task-owned callbacks and the optional SetStateMachine return handshake before any restore writes. */
export function validateSnapshotAsyncContinuations(context) {
  const tasks = new Map((context.snapshot.scheduler?.tasks ?? []).map(([, task]) => [key(task.ref), task]));
  for (const task of tasks.values()) {
    const terminal = terminalContext(task.status);
    if (task.continuations !== undefined) {
      if (!Array.isArray(task.continuations) || task.continuations.length > context.vm.scheduler.maxContexts ||
          terminal && task.continuations.length) fail('pending callback inventory');
      for (const value of task.continuations) continuation(context, value);
    }
    if (task.asyncMachine != null) {
      if (!terminal && task.asyncState !== undefined) fail('duplicate machine representation');
      machine(context, task.asyncMachine, !terminal);
    }
  }
  for (const frame of context.frames.values()) {
    if (frame.asyncRegistration !== undefined) registration(context, frame, tasks);
  }
}
