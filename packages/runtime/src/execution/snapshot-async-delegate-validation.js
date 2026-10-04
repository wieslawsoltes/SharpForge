import {managedDelegateSignature, normalizeCallType} from '@sharpforge/cil';
import {CastCache} from './casting.js';
import {runtimeTypeName} from './method-table.js';
import {invalidSnapshot} from './snapshot-validation-helpers.js';

const fail = part => invalidSnapshot('async continuation ' + part);

function properties(record) {
  if (!Array.isArray(record.data) || record.data.length % 2) fail('delegate properties');
  const result = new Map();
  for (let index = 0; index < record.data.length; index += 2) {
    const name = record.data[index];
    if (typeof name !== 'string' || result.has(name)) fail('delegate property identity');
    result.set(name, record.data[index + 1]);
  }
  return result;
}

function receiverMatches(context, receiver, type, nullable) {
  const registry = context.vm.heap.methodTables;
  const target = registry.tables.get(runtimeTypeName(type));
  if (!target || target.flags.valueType || target.flags.byRef || target.flags.pointer) return false;
  if (receiver === null) return nullable;
  const actual = context.referenceRecord(receiver).methodTable;
  // Use an isolated cast walk: rejected restore must not materialize types or alter the live cast cache.
  return new CastCache(registry).assignable(target, actual, new Map());
}

function validateTarget(context, values) {
  const vm = context.vm;
  const token = values.get('method');
  if (!Number.isInteger(token) || vm.inspector && !vm.report.methods.includes(token)) fail('unverified delegate target');
  const method = vm.inspector ? vm.inspector.getMethod(token) : vm.image.methods[token];
  if (!method) fail('delegate target');
  const signature = method.signature ?? method;
  const parameters = signature.parameters.map(parameter => typeof parameter === 'string' ? parameter : parameter.type);
  if (normalizeCallType(signature.returnType) !== 'void') fail('delegate result');
  const receiver = values.get('receiver');
  const mode = values.get('mode') ?? (signature.isStatic
    ? parameters.length === 1 ? 'closed-static' : 'static' : 'closed-instance');
  if (mode === 'static') {
    if (!signature.isStatic || parameters.length || receiver !== null) fail('static delegate binding');
  } else if (mode === 'closed-static') {
    if (!signature.isStatic || parameters.length !== 1 || !receiverMatches(context, receiver, parameters[0], true)) {
      fail('closed static delegate binding');
    }
  } else if (mode === 'closed-instance') {
    if (signature.isStatic || parameters.length || !receiverMatches(context, receiver, method.owner, false)) {
      fail('instance delegate binding');
    }
  } else fail('zero-argument delegate binding');
}

/** Inspect only captured delegate records; pending callbacks must be callable with no arguments and no result. */
export function validateSnapshotAsyncDelegate(context, reference) {
  const root = context.referenceRecord(reference);
  const signature = managedDelegateSignature(context.vm.inspector, root.type);
  if (root.kind !== 'delegate' || !signature || signature.parameters.length || signature.returnType !== 'void') {
    fail('delegate signature');
  }
  const values = properties(root);
  const list = values.get('invocationList');
  if (list === undefined || list === null) return validateTarget(context, values);
  const record = context.referenceRecord(list);
  if (record.kind !== 'array' || !Array.isArray(record.data) || !record.data.length ||
      record.data.length > (context.vm.options.maxDelegateTargets ?? 4096)) fail('delegate invocation list');
  for (const entry of record.data) {
    const child = context.referenceRecord(entry);
    if (child.kind !== 'delegate' || child.methodTable !== root.methodTable) fail('delegate invocation entry');
    const childValues = properties(child);
    // The runtime flattens multicast lists at construction; nesting would not use the same invocation semantics.
    if (childValues.get('invocationList') != null) fail('nested delegate invocation list');
    validateTarget(context, childValues);
  }
}
