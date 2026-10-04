import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, instructionProfile} from '@sharpforge/runtime';

const text = `class Program { static int Main() {
  int total = 0; for (int i = 0; i < 5; i++) total += i; return total;
} }`;
function create(source = text, options = {}) {
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return new VirtualMachine(result.image, {sourceFusion: false, ...options});
}

// Generated <startup> legitimately performs a method-entry observer lookup.
// Admit Main normally before isolating per-slice instruction-observer capture.
function enterMain(vm) {
  for (let steps = 0; vm.image.methods[vm.top.methodId].name !== 'Main' && steps < 100; steps++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    assert.equal(vm.fault, null);
  }
  assert.equal(vm.image.methods[vm.top.methodId].name, 'Main');
  assert.equal(vm.top.pc, 0, 'No Main instruction executes during startup admission');
  return vm.instructions;
}

function observer(name, log) {
  return {
    instruction(frame) { log.push([name, 'instruction', frame.id, frame.pc]); },
    closeSlice() { log.push([name, 'close']); },
    reportClockFailure() { log.push([name, 'clock']); }
  };
}

test('source slices capture observer identity once but retain dynamic instruction-method lookup', () => {
  const vm = create();
  const initialInstructions = enterMain(vm);
  const log = [];
  const first = observer('first', log);
  const second = observer('second', log);
  let reads = 0;
  let selected = first;
  first.instruction = frame => {
    log.push(['first-original', 'instruction', frame.id, frame.pc]);
    selected = second;
    first.instruction = next => log.push(['first-replaced', 'instruction', next.id, next.pc]);
  };
  Object.defineProperty(vm, 'profiler', {configurable: true, get() { reads++; return selected; }});
  try {
    vm.runSlice({instructionBudget: 3, timeBudgetMs: Infinity});
    assert.equal(reads, 1);
    assert.equal(vm.instructions, initialInstructions + 3);
    assert.deepEqual(log.map(item => item.slice(0, 2)), [
      ['first-original', 'instruction'], ['first-replaced', 'instruction'], ['first-replaced', 'instruction'],
      ['first', 'close'], ['first', 'clock']]);
    vm.runSlice({instructionBudget: 3, timeBudgetMs: Infinity});
    assert.equal(reads, 2);
    assert.equal(vm.instructions, initialInstructions + 6);
    assert.deepEqual(log.slice(5).map(item => item.slice(0, 2)), [
      ['second', 'instruction'], ['second', 'instruction'], ['second', 'instruction'], ['second', 'close'], ['second', 'clock']]);
  } finally { delete vm.profiler; vm.stop(); }
});

test('source sequence pause and exhausted slice budget do not emit instruction observations', () => {
  const vm = create();
  const initialInstructions = enterMain(vm);
  const log = [];
  const profiler = observer('observer', log);
  Object.defineProperty(vm, 'profiler', {configurable: true, get: () => profiler});
  try {
    vm.runSlice({instructionBudget: 0, timeBudgetMs: Infinity});
    assert.equal(vm.instructions, initialInstructions);
    let beforePause;
    vm.runSlice({instructionBudget: 100, timeBudgetMs: Infinity, onSequence: (_point, frame) => {
      beforePause = {pc: frame.pc, instructions: vm.instructions, observed: log.filter(item => item[1] === 'instruction').length};
      return true;
    }});
    assert.equal(vm.state, 'paused');
    assert(beforePause);
    assert.equal(vm.instructions, beforePause.instructions);
    assert.equal(vm.top.pc, beforePause.pc);
    assert.equal(log.filter(item => item[1] === 'instruction').length, beforePause.observed);
    assert.deepEqual(log.filter(item => item[1] !== 'instruction'), [
      ['observer', 'close'], ['observer', 'clock'], ['observer', 'close'], ['observer', 'clock']]);
  } finally { delete vm.profiler; vm.stop(); }
});

test('an instruction observer failure retains fault accounting and slice finalization before opcode execution', () => {
  const vm = create();
  const log = [];
  const profiler = observer('observer', log);
  profiler.instruction = () => { throw new Error('instruction observer sentinel'); };
  Object.defineProperty(vm, 'profiler', {configurable: true, get: () => profiler});
  try {
    vm.runSlice({instructionBudget: 100, timeBudgetMs: Infinity});
    assert.equal(vm.state, 'faulted');
    assert.match(vm.fault.message, /instruction observer sentinel/);
    assert.equal(vm.instructions, 1);
    assert.equal(vm.top.pc, 1);
    assert.deepEqual(vm.stack, []);
    assert.deepEqual(log, [['observer', 'close'], ['observer', 'clock']]);
  } finally { delete vm.profiler; vm.stop(); }
});

test('real source profiling counts each budget-one instruction and fault exactly as ordinary execution', () => {
  const source = `class Program { static int Main() { int divisor = 0; return 10 / divisor; } }`;
  const plain = create(source);
  const vm = create(source, {profile: true});
  try {
    for (let steps = 0; ['ready', 'running'].includes(vm.state) && steps < 100; steps++) {
      plain.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      assert.equal(vm.state, plain.state);
      assert.equal(vm.instructions, plain.instructions);
      assert.equal(instructionProfile(vm).instructions, vm.instructions);
    }
    assert.equal(vm.state, 'faulted');
    assert.equal(vm.fault.name, plain.fault.name);
    assert.match(vm.fault.message, /zero/i);
    assert.equal(instructionProfile(vm).methods.reduce((sum, row) => sum + row.instructions, 0), vm.instructions);
  } finally { plain.stop(); vm.stop(); }
});
