import {CilOpcodes, verifiedStackBound} from '@sharpforge/cil';
import {wasmMetadataFits} from './metadata-budget.js';

const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);

/** Recognize a successful actual branch, excluding leave's intermediate unwind destinations. */
export function executedBackedge(vm, frame, instruction, index, frameId) {
  if (vm.top !== frame || frame.id !== frameId || frame.pc > index || frame.pc < 0 ||
      frame.method.instructions[index] !== instruction || !frame.method.instructions[frame.pc]) return false;
  if (instruction.name === 'leave' || instruction.name === 'leave.s') return false;
  const operand = CilOpcodes[instruction.name]?.operand;
  if (operand === 'switch') return true;
  return (operand === 'br8' || operand === 'br32') && instruction.operand === frame.method.instructions[frame.pc].offset;
}

function admit(vm, record, options) {
  const method = record.method;
  if (record.backedges) {
    const saved = record.backedges;
    if (saved.body !== method.instructions || saved.handlers !== method.handlers || saved.maxStack !== method.maxStack) {
      saved.reason = 'WASM_STALE';
    }
    return saved;
  }
  const counters = {body: method.instructions, handlers: method.handlers, maxStack: method.maxStack,
    sites: new Map(), siteCount: 0, total: 0, hottest: 0, overflow: 0, reason: null};
  record.backedges = counters;
  try {
    if (method.instructions.length > options.maxMethodInstructions) counters.reason = 'WASM_SIZE';
    else if (!wasmMetadataFits(method, options.maxAnalysisSlots * 4)) counters.reason = 'WASM_ANALYSIS_LIMIT';
    else if (!verifiedStackBound(vm.inspector, vm.report, method)) counters.reason = 'WASM_UNVERIFIED';
  } catch {
    // Instrumentation cannot turn rejected optimization metadata into a guest fault.
    counters.reason = 'WASM_UNVERIFIED';
  }
  return counters;
}

/** Warm source/target hits allocate no objects; cold proof and retained sites have explicit bounds. */
export function countWasmBackedge(vm, record, from, to, options) {
  const counters = admit(vm, record, options);
  if (counters.reason) return false;
  counters.total = increment(counters.total);
  let targets = counters.sites.get(from);
  let site = targets?.get(to);
  if (!site) {
    if (counters.siteCount >= options.maxBackedgesPerMethod) {
      counters.overflow = increment(counters.overflow);
      return false;
    }
    if (!targets) {
      targets = new Map();
      counters.sites.set(from, targets);
    }
    site = {fromOffset: record.method.instructions[from].offset,
      toOffset: record.method.instructions[to].offset, count: 0};
    targets.set(to, site);
    counters.siteCount++;
  }
  site.count = increment(site.count);
  counters.hottest = Math.max(counters.hottest, site.count);
  return site.count >= options.backedgeThreshold;
}

/** Detached frozen rows ordered by source then target IL offset. */
export function wasmBackedgeStatistics(record) {
  const counters = record.backedges, sites = [];
  if (counters) for (const targets of counters.sites.values()) {
    for (const site of targets.values()) sites.push(Object.freeze({...site}));
  }
  sites.sort((left, right) => left.fromOffset - right.fromOffset || left.toOffset - right.toOffset);
  return {backedges: counters?.total ?? 0, hottestBackedge: counters?.hottest ?? 0,
    backedgeOverflow: counters?.overflow ?? 0, backedgeReason: counters?.reason ?? null, backedgeSites: Object.freeze(sites)};
}
