import { decodeInstructions } from '@sharpforge/cil';
import { PdbGuids, fail } from './contracts.js';

function requireMethod(pe, methodToken) {
  if (!Number.isInteger(methodToken) || methodToken < 0x06000001 || methodToken > 0x06ffffff) {
    fail('Invalid async stepping MethodDef token');
  }
  if ((methodToken & 0xffffff) > (pe.metadata.counts[6] ?? 0)) fail('Invalid async stepping MethodDef row');
}

function methodInstructions(pe, methodToken, bodies) {
  requireMethod(pe, methodToken);
  if (!bodies.has(methodToken)) {
    if (!pe.metadata.row(methodToken)[0]) fail('Async stepping method has no IL body');
    const body = pe.methodBody(methodToken);
    bodies.set(methodToken, {
      body,
      offsets: new Set(decodeInstructions(body.code).map((instruction) => instruction.offset)),
    });
  }
  return bodies.get(methodToken);
}

function requireOffset(method, offset, label) {
  if (!Number.isInteger(offset) || !method.offsets.has(offset)) {
    fail('Async ' + label + ' offset is not an IL instruction boundary');
  }
}

/** Translate explicit state-machine stepping data; each referenced IL body is decoded at most once. */
export function asyncSteppingRecords(pe, records, existing) {
  if (!records.length) return existing;
  const bodies = new Map();
  const custom = [...existing];
  for (const record of records) {
    if (!Object.hasOwn(record, 'awaits') && !Object.hasOwn(record, 'catchHandlerOffset')) continue;
    const awaits = record.awaits === undefined ? [] : record.awaits;
    if (!Array.isArray(awaits) || awaits.length > 1_000_000) fail('Invalid async await record list');
    requireMethod(pe, record.kickoff);
    const method = methodInstructions(pe, record.moveNext, bodies);
    const catchHandlerOffset = record.catchHandlerOffset === undefined ? -1 : record.catchHandlerOffset;
    if (catchHandlerOffset !== -1) {
      requireOffset(method, catchHandlerOffset, 'catch handler');
      if (!method.body.handlers.some((handler) => handler.flags === 0 && handler.target === catchHandlerOffset)) {
        fail('Async catch handler offset is not a catch clause entry');
      }
    }
    const steps = awaits.map((step) => {
      if (!step || typeof step !== 'object') fail('Invalid async await record');
      requireOffset(method, step.yieldOffset, 'yield');
      const resume = methodInstructions(pe, step.resumeMethod, bodies);
      requireOffset(resume, step.resumeOffset, 'resume');
      return { yieldOffset: step.yieldOffset, resumeOffset: step.resumeOffset, resumeMethod: step.resumeMethod };
    });
    custom.push({ parent: record.moveNext, kind: PdbGuids.asyncSteps, catchHandlerOffset, awaits: steps });
  }
  return custom;
}
