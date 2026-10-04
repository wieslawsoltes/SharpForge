import { PdbGuids, fail } from './contracts.js';

function methodToken(value, count) {
  if (!Number.isInteger(value) || value < 0x06000001 || value > 0x06000000 + count) {
    fail('Invalid async information MethodDef');
  }
  return value;
}

function snapshotFacts(stateMachines, custom, maxEntries, methodCount) {
  let entries = stateMachines.length * 2;
  if (entries > maxEntries) fail('Async information entry limit exceeded');
  for (const record of custom) {
    if (record.kind !== PdbGuids.asyncSteps) continue;
    if (!Array.isArray(record.awaits)) fail('Invalid async information awaits');
    entries += 1 + record.awaits.length;
    if (entries > maxEntries) fail('Async information entry limit exceeded');
  }
  const pairs = stateMachines.map(({ moveNext, kickoff }) => ({
    moveNext: methodToken(moveNext, methodCount),
    kickoff: methodToken(kickoff, methodCount),
  }));
  const records = [];
  for (const record of custom) {
    if (record.kind !== PdbGuids.asyncSteps) continue;
    const parent = methodToken(record.parent, methodCount);
    const steps = record.awaits.map(({ yieldOffset, resumeOffset, resumeMethod }) => ({
      yieldOffset,
      resumeOffset,
      resumeMethod: methodToken(resumeMethod, methodCount),
    }));
    records.push({ parent, steps });
  }
  return { pairs, records };
}

function buildIndex(facts) {
  const methods = new Map();
  const steps = new Map();
  for (const pair of facts.pairs) {
    if (pair.moveNext === pair.kickoff || methods.has(pair.moveNext) || methods.has(pair.kickoff)) {
      fail('Ambiguous async information method mapping');
    }
    methods.set(pair.moveNext, pair);
    methods.set(pair.kickoff, pair);
  }
  for (const record of facts.records) {
    if (steps.has(record.parent)) fail('Duplicate async information stepping record');
    steps.set(record.parent, record.steps);
  }
  return { methods, steps };
}

function lookupFromFacts(facts) {
  let index;
  return (token) => {
    if (!index) {
      index = buildIndex(facts);
      facts = null;
    }
    const pair = index.methods.get(token);
    const steps = index.steps.get(pair?.moveNext ?? token) ?? [];
    return { stateMachine: pair ? { ...pair } : null, steps: steps.map((step) => ({ ...step })) };
  };
}

/** Capture bounded values once; kickoff and MoveNext queries return independent records from a lazy index. */
export function createAsyncInfoLookup(stateMachines, custom, { maxAsyncEntries = 100_000, methodCount = 0 } = {}) {
  if (!Number.isInteger(maxAsyncEntries) || maxAsyncEntries < 0 || maxAsyncEntries > 1_000_000) {
    fail('Invalid async information entry limit');
  }
  if (!Number.isInteger(methodCount) || methodCount < 0 || methodCount > 0xffffff) {
    fail('Invalid async information method count');
  }
  return lookupFromFacts(snapshotFacts(stateMachines, custom, maxAsyncEntries, methodCount));
}
