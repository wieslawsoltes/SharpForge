import {Op, BinaryName} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {sourceCopy, sourceStore, sourceInputTypes} from './source-storage.js';
import {executionCodeState} from './code-version.js';

const comparisons = new Set(['==', '!=', '<', '<=', '>', '>=']);

function loadLocal(vm, frame, index) {
  const value = frame.locals[index];
  if (value === undefined) throw new ManagedFault('InvalidProgramException', 'Read of uninitialized local');
  return sourceCopy(vm, value);
}

function advance(vm, frame) {
  frame.pc++;
  vm.instructions++;
}

function storeLocal(vm, frame, index, type) {
  frame.locals[index] = sourceStore(vm, vm.stack.at(-1), type, sourceInputTypes(vm, frame).at(-1));
  vm.stack[vm.stack.length - 1] = sourceCopy(vm, frame.locals[index]);
  // A local write does not mutate the heap. Observed writes always take ordinary dispatch.
  vm.writeRevision++;
}

function localBinary(code, pc, statistics, {constant = false, storeType = null, branch = false} = {}) {
  const leftIndex = code[pc * 3 + 1];
  const rightIndex = code[(pc + 1) * 3 + 1];
  const operator = BinaryName[code[(pc + 2) * 3 + 1]];
  const mode = code[(pc + 2) * 3 + 2];
  const finalOperand = code[(pc + 3) * 3 + 1];
  return Object.freeze({
    length: storeType !== null || branch ? 4 : 3,
    execute(vm, frame) {
      statistics.sourceFusionGroups++;
      // Keep the first operand rooted and visible if loading the second operand faults.
      vm.stack.push(loadLocal(vm, frame, leftIndex));
      advance(vm, frame);
      const right = constant ? vm.constant(rightIndex) : loadLocal(vm, frame, rightIndex);
      advance(vm, frame);
      const left = vm.stack.pop();
      vm.stack.push(vm.binary(operator, left, right, mode));
      if (storeType !== null) {
        advance(vm, frame);
        storeLocal(vm, frame, finalOperand, storeType);
      } else if (branch) {
        advance(vm, frame);
        if (!vm.stack.pop()) frame.pc = finalOperand;
      }
    }
  });
}

function compareBranch(code, pc, statistics) {
  const operator = BinaryName[code[pc * 3 + 1]];
  const mode = code[pc * 3 + 2];
  const target = code[(pc + 1) * 3 + 1];
  return Object.freeze({
    length: 2,
    execute(vm, frame) {
      statistics.sourceFusionGroups++;
      const right = vm.stack.pop(), left = vm.stack.pop();
      vm.stack.push(vm.binary(operator, left, right, mode));
      advance(vm, frame);
      if (!vm.stack.pop()) frame.pc = target;
    }
  });
}

function buildPlan(method, statistics) {
  const started = performance.now();
  const code = method.code, count = code.length / 3;
  const groups = Array(count).fill(null), entries = new Set();
  for (let pc = 0; pc < count; pc++) {
    if ([Op.JUMP, Op.JFALSE, Op.JTRUE].includes(code[pc * 3])) entries.add(code[pc * 3 + 1]);
  }
  const straight = (pc, length) => {
    if (pc + length > count) return false;
    for (let offset = 1; offset < length; offset++) if (entries.has(pc + offset)) return false;
    return true;
  };
  // Protected regions retain one-instruction dispatch and the existing two-pass EH boundaries.
  if (!method.handlers?.length) for (let pc = 0; pc < count; pc++) {
    const op = code[pc * 3], next = code[(pc + 1) * 3], third = code[(pc + 2) * 3];
    const fourth = code[(pc + 3) * 3];
    if (op === Op.LDLOC && next === Op.CONST && third === Op.BINARY && fourth === Op.STLOC && straight(pc, 4)) {
      const storeType = method.locals[code[(pc + 3) * 3 + 1]].type;
      groups[pc] = localBinary(code, pc, statistics, {constant: true, storeType});
    } else if (op === Op.LDLOC && next === Op.LDLOC && third === Op.BINARY && straight(pc, 3)) {
      const branch = fourth === Op.JFALSE && comparisons.has(BinaryName[code[(pc + 2) * 3 + 1]]) && straight(pc, 4);
      groups[pc] = localBinary(code, pc, statistics, {branch});
    } else if (op === Op.BINARY && next === Op.JFALSE && comparisons.has(BinaryName[code[pc * 3 + 1]]) && straight(pc, 2)) {
      groups[pc] = compareBranch(code, pc, statistics);
    }
  }
  statistics.sourcePlans++;
  statistics.sourcePlanMilliseconds += performance.now() - started;
  return Object.freeze({groups: Object.freeze(groups), groupCount: groups.filter(Boolean).length});
}

/** Private executable plan: method identity, code-array replacement and code epochs invalidate it. */
export function getSourceFusionPlan(vm, method) {
  const state = executionCodeState(vm);
  const cache = state.source ??= {methods: new WeakMap(), lastMethod: null, lastEntry: null};
  if (cache.lastMethod === method && cache.lastEntry.code === method.code) return cache.lastEntry.plan;
  let entry = cache.methods.get(method);
  if (!entry || entry.code !== method.code) {
    entry = {code: method.code, plan: buildPlan(method, state.statistics)};
    cache.methods.set(method, entry);
  }
  cache.lastMethod = method;
  cache.lastEntry = entry;
  return entry.plan;
}

/** Select a bounded group before advancing its first instruction. Observers keep original dispatch. */
export function selectSourceFusion(vm, frame, method, remaining, onSequence) {
  if (remaining < 2 || vm.options.sourceFusion === false || vm.scheduler.enabled || vm.scheduler.suppressed
      || onSequence || vm.onWrite || vm.onException || vm.profiler || vm.options.profile
      || vm.options.gcStress === 'instruction' || frame.intrinsicContinuation || frame.filterSearch
      || frame.unwinds?.length || method.handlers?.length) return null;
  const op = method.code[frame.pc * 3];
  if (op !== Op.LDLOC && op !== Op.BINARY) return null;
  const group = getSourceFusionPlan(vm, method).groups[frame.pc];
  return group && group.length <= remaining && group.length <= vm.options.maxInstructions - vm.instructions ? group : null;
}
