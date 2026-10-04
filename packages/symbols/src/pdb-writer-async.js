import { decodeInstructions } from '@sharpforge/cil';
import { PdbGuids, fail } from './contracts.js';

const budgets = {
  maxStateMachines: [10_000, 100_000],
  maxAwaits: [100_000, 1_000_000],
  maxBodyBytes: [8 * 1024 * 1024, 64 * 1024 * 1024],
  maxInstructions: [250_000, 1_000_000],
};

function limitsFor(options = {}) {
  if (!options || typeof options !== 'object') fail('Invalid async stepping limits');
  const limits = {};
  for (const [name, [defaultValue, maximum]] of Object.entries(budgets)) {
    const value = options[name] ?? defaultValue;
    if (!Number.isInteger(value) || value < 0 || value > maximum) fail('Invalid async stepping ' + name);
    limits[name] = value;
  }
  return limits;
}

function requireMethod(pe, methodToken) {
  if (!Number.isInteger(methodToken) || methodToken < 0x06000001 || methodToken > 0x06ffffff) {
    fail('Invalid async stepping MethodDef token');
  }
  if ((methodToken & 0xffffff) > (pe.metadata.counts[6] ?? 0)) fail('Invalid async stepping MethodDef row');
}

const hasSteps = (record) => Object.hasOwn(record, 'awaits') || Object.hasOwn(record, 'catchHandlerOffset');
const awaitRecords = (record) => (record.awaits === undefined ? [] : record.awaits);

function preflight(pe, records, limits) {
  if (records.length > limits.maxStateMachines) fail('Async state-machine record limit exceeded');
  const methods = new Set();
  let awaitCount = 0;
  for (const record of records) {
    if (!record || typeof record !== 'object') fail('Invalid state-machine record');
    if (!hasSteps(record)) continue;
    const awaits = awaitRecords(record);
    if (!Array.isArray(awaits)) fail('Invalid async await record list');
    awaitCount += awaits.length;
    if (awaitCount > limits.maxAwaits) fail('Aggregate async await limit exceeded');
    requireMethod(pe, record.kickoff);
    requireMethod(pe, record.moveNext);
    methods.add(record.moveNext);
    for (const step of awaits) {
      if (!step || typeof step !== 'object') fail('Invalid async await record');
      requireMethod(pe, step.resumeMethod);
      methods.add(step.resumeMethod);
    }
  }
  const bodies = new Map();
  let bodyBytes = 0;
  for (const methodToken of methods) {
    if (!pe.metadata.row(methodToken)[0]) fail('Async stepping method has no IL body');
    const body = pe.methodBody(methodToken);
    bodyBytes += body.code.length;
    if (bodyBytes > limits.maxBodyBytes) fail('Aggregate async body byte limit exceeded');
    bodies.set(methodToken, { body, offsets: null });
  }
  return { bodies, remainingInstructions: limits.maxInstructions };
}

function methodInstructions(methodToken, state) {
  const method = state.bodies.get(methodToken);
  if (!method.offsets) {
    const instructions = decodeInstructions(method.body.code, { maxInstructions: state.remainingInstructions });
    state.remainingInstructions -= instructions.length;
    method.offsets = new Set();
    // The existing decoder returns an array; retain only offsets and avoid another mapped array.
    for (const instruction of instructions) method.offsets.add(instruction.offset);
  }
  return method;
}

function requireOffset(method, offset, label) {
  if (!Number.isInteger(offset) || !method.offsets.has(offset)) {
    fail('Async ' + label + ' offset is not an IL instruction boundary');
  }
}

/** Preflight aggregate budgets before expanding records or decoding any referenced IL body. */
export function asyncSteppingRecords(pe, records, existing, options) {
  if (!Array.isArray(records)) fail('Invalid state-machine records');
  if (!records.length && options === undefined) return existing;
  const state = preflight(pe, records, limitsFor(options));
  const custom = [...existing];
  for (const record of records) {
    if (!hasSteps(record)) continue;
    const method = methodInstructions(record.moveNext, state);
    const catchHandlerOffset = record.catchHandlerOffset === undefined ? -1 : record.catchHandlerOffset;
    if (catchHandlerOffset !== -1) {
      requireOffset(method, catchHandlerOffset, 'catch handler');
      if (!method.body.handlers.some((handler) => handler.flags === 0 && handler.target === catchHandlerOffset)) {
        fail('Async catch handler offset is not a catch clause entry');
      }
    }
    const steps = awaitRecords(record).map((step) => {
      requireOffset(method, step.yieldOffset, 'yield');
      requireOffset(methodInstructions(step.resumeMethod, state), step.resumeOffset, 'resume');
      return { yieldOffset: step.yieldOffset, resumeOffset: step.resumeOffset, resumeMethod: step.resumeMethod };
    });
    custom.push({ parent: record.moveNext, kind: PdbGuids.asyncSteps, catchHandlerOffset, awaits: steps });
  }
  return custom;
}
