import {compileFixture, createVM, abortIfNeeded, hostMemory, managedMemory} from './operations.js';
import {qualificationVmOptions, checkQualificationLimit, runQualificationVM} from './qualification-execution.js';
import {hash} from './evidence.js';

function sliceDistribution(slices) {
  const sorted = slices.map(slice => slice.durationMs).sort((left, right) => left - right);
  if (!sorted.length || sorted.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Invalid slice timing');
  const quantile = probability => {
    const position = (sorted.length - 1) * probability, lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  };
  return {count: sorted.length, minimum: sorted[0], median: quantile(0.5), p95: quantile(0.95),
    p99: quantile(0.99), maximum: sorted.at(-1)};
}

function sortFixture(elements) {
  return {id: 'descending-sort-' + elements, source: `using System; class Program {
    static void Main() { int[] values = new int[${elements}];
      for (int i = 0; i < values.Length; i++) values[i] = values.Length - i - 1;
      Console.WriteLine("ready"); Array.Sort(values); Console.WriteLine("sorted");
      for (int i = 0; i < values.Length; i++) {
        if (values[i] != i) throw new Exception("Incorrect sorted element");
      }
      Console.WriteLine("verified");
    }
  }`, expected: 'ready\nsorted\nverified\n'};
}

async function reachBoundary(vm, phase, expected, deadline, signal) {
  while (vm.state === 'ready' || vm.state === 'running') {
    checkQualificationLimit(deadline, signal);
    vm.runSlice({instructionBudget: 10000, timeBudgetMs: 8});
    if (vm.state === 'running') await new Promise(resolve => setImmediate(resolve));
  }
  if (vm.fault || vm.state !== 'paused' || phase.name !== expected) {
    throw new Error('Array fairness boundary failed: ' + (vm.fault?.message ?? phase.name + '/' + vm.state));
  }
}

/** Every sort-phase runSlice is timed in one real execution; slice percentiles are not independent complete-sort repetitions. */
export async function measureArrayFairness(engine, options, signal) {
  abortIfNeeded(signal);
  const elements = options.arrayElements ?? 1000000;
  if (!Number.isInteger(elements) || elements < 32 || elements > 1000000) throw new RangeError('Array size must be 32–1000000');
  if (![32, 64].includes(options.nativeBits) || !Number.isFinite(options.timeoutSeconds) ||
      options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) throw new RangeError('Invalid fairness ABI or time limit');
  const fixture = sortFixture(elements), artifact = compileFixture(fixture), phase = {name: 'initializing', output: ''};
  const deadline = performance.now() + options.timeoutSeconds * 1000;
  const vmOptions = qualificationVmOptions(options);
  let vm;
  vm = createVM(engine, artifact, {...vmOptions, onOutput(text) {
    phase.output += text;
    if (phase.output === 'ready\n' || phase.output === 'ready\nsorted\n') {
      phase.name = phase.output === 'ready\n' ? 'ready' : 'sorted';
      vm.state = 'paused';
    }
  }});
  const row = {id: 'array-sort-fairness-' + engine, engine, elements, status: 'running', assemblyHash: hash(artifact.assembly),
    vmOptions, requestedSliceMs: 8, requestedInstructionBudget: 10000, slices: [],
    measurement: 'One descending-array sort; each continuation slice retains its own raw time and counters'};
  try {
    await reachBoundary(vm, phase, 'ready', deadline, signal);
    globalThis.gc?.();
    const allocationsBefore = managedMemory(vm), sortStarted = performance.now();
    vm.state = 'running';
    while (vm.state === 'running') {
      checkQualificationLimit(deadline, signal);
      if (row.slices.length >= 100000) throw new Error('Array fairness exceeded its slice count limit');
      const hostBefore = hostMemory(), instructions = vm.instructions, started = performance.now();
      vm.runSlice({instructionBudget: 10000, timeBudgetMs: 8});
      const durationMs = performance.now() - started;
      row.slices.push({index: row.slices.length, durationMs, instructions: vm.instructions - instructions,
        hostBefore, hostAfter: hostMemory()});
      if (vm.state === 'running') await new Promise(resolve => setImmediate(resolve));
    }
    row.sortWallMs = performance.now() - sortStarted;
    if (vm.state !== 'paused' || phase.name !== 'sorted' || vm.fault) {
      throw new Error('Sort did not reach its completion boundary: ' + (vm.fault?.message ?? vm.state));
    }
    const allocationsAfter = managedMemory(vm);
    row.managedAllocations = allocationsAfter.allocations - allocationsBefore.allocations;
    row.managedAllocatedBytes = allocationsAfter.allocatedBytes - allocationsBefore.allocatedBytes;
    vm.state = 'running';
    await runQualificationVM(vm, deadline, signal);
    if (vm.output.join('') !== fixture.expected) throw new Error('Full sorted-array verification did not complete');
    row.outputVerified = true;
    row.summary = {sliceMs: sliceDistribution(row.slices)};
    row.target = {kind: 'maximum-observed-slice', value: 16, unit: 'milliseconds', observed: row.summary.sliceMs.maximum,
      requiredElements: 1000000, meetsAcceptanceSize: elements === 1000000,
      acceptance: elements < 1000000 ? 'partial' : row.summary.sliceMs.maximum <= 16 ? 'met' : 'missed'};
    row.status = 'measured';
    return row;
  } catch (error) {
    row.status = signal?.aborted ? 'cancelled' : 'failed';
    error.evidence = row;
    throw error;
  } finally { vm.stop(); }
}
