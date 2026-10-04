import {CilVirtualMachine, prepareWasmMethod, runWasmSlice, disposeWasmMethod, instructionProfile} from '@sharpforge/runtime';
import {wasmHeapFixture} from '../../support/wasm-heap-fixture.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

/** Observe real native imports; every wrapper forwards to the unchanged runtime helper. */
async function prepareObserved(vm, observation) {
  const backend = globalThis.WebAssembly;
  check(typeof backend?.instantiate === 'function', 'actual browser WebAssembly is required');
  const descriptor = Object.getOwnPropertyDescriptor(backend, 'instantiate');
  const instantiate = backend.instantiate;
  backend.instantiate = async (bytes, imports) => {
    check(bytes instanceof Uint8Array && bytes.byteLength > 8, 'actual encoded Wasm bytes are required');
    check(imports?.runtime && Object.keys(imports).length === 1, 'expected managed runtime import namespace');
    const runtime = Object.fromEntries(Object.entries(imports.runtime).map(([name, helper]) => {
      check(typeof helper === 'function', 'native runtime import must be callable');
      return [name, (...args) => {
        observation.importCalls[name] = (observation.importCalls[name] ?? 0) + 1;
        observation.programCounters.push(vm.top.pc - 1);
        return helper(...args);
      }];
    }));
    const result = await instantiate.call(backend, bytes, {runtime});
    check(result.module instanceof backend.Module && result.instance instanceof backend.Instance,
      'preparation must return an actual native WebAssembly module and instance');
    observation.instantiations.push({byteLength: bytes.byteLength,
      imports: backend.Module.imports(result.module), exports: backend.Module.exports(result.module)});
    return result;
  };
  try { return await prepareWasmMethod(vm); }
  finally { Object.defineProperty(backend, 'instantiate', descriptor); }
}

function writeValue(vm, value) {
  if (value && typeof value === 'object' && Number.isInteger(value.h) && Number.isInteger(value.g)) {
    const record = vm.heap.get(value);
    return {kind: record.kind, type: record.type, value: record.kind === 'string' ? record.data : null};
  }
  return value;
}

function collectRun(vm, handle, methodToken) {
  const writes = [], mainProgramCounters = [];
  let safepointCollections = 0;
  vm.onWrite = event => writes.push({...event, value: writeValue(vm, event.value), oldValue: writeValue(vm, event.oldValue)});
  const onInstruction = (instruction, frame) => {
    if (frame.method.token === methodToken) mainProgramCounters.push(frame.pc);
    vm.heap.collect();
    safepointCollections++;
  };
  for (let slices = 0; ['ready', 'running'].includes(vm.state) && slices < 1000; slices++) {
    const options = {instructionBudget: 7, timeBudgetMs: 1000, onInstruction};
    if (handle) runWasmSlice(vm, handle, options);
    else vm.runSlice(options);
  }
  equal(vm.state, 'terminated', 'heap fixture terminates');
  equal(vm.fault, null, 'heap fixture has no fault');
  equal(safepointCollections, vm.instructions, 'collect at every actual guest instruction');
  // No host handle/pin is installed: only the VM return value keeps the string alive here.
  vm.heap.collect();
  equal(vm.value(vm.returnValue), 'rooted', 'managed return reference survives final collection');
  check([...vm.statics.values()].includes(123), 'compiled static write must reach actual managed storage');
  const stats = vm.heap.stats;
  const result = {instructions: vm.instructions, result: vm.value(vm.returnValue), output: vm.output.join(''),
    mainProgramCounters, safepointCollections, writes, writeRevision: vm.writeRevision,
    heap: {allocations: stats.allocations, allocatedBytes: stats.allocatedBytes, collections: stats.collections,
      liveObjects: stats.liveObjects, liveBytes: stats.liveBytes, freedObjects: stats.freedObjects,
      mutationRevision: vm.heap.mutationRevision}, profile: instructionProfile(vm)};
  const reference = vm.returnValue;
  vm.returnValue = null;
  vm.heap.collect();
  let collected = false;
  try { vm.heap.get(reference); }
  catch (error) {
    if (error.name !== 'InvalidReferenceException') throw error;
    collected = true;
  }
  check(collected, 'removing the sole return root must allow collection; the observer cannot pin the result');
  result.returnRootProbe = {survivedWithRoot: true, collectedWithoutRoot: collected, extraCollections: 1};
  return result;
}

/** The exact Node heap-bridge guest, prepared and executed by the browser's native WebAssembly engine. */
export async function wasmHeapBridge() {
  const bytes = wasmHeapFixture();
  const options = {initialThreshold: 1, profile: true, weakStringInterning: true};
  const baseline = new CilVirtualMachine(bytes, options);
  const vm = new CilVirtualMachine(bytes, options);
  const observation = {instantiations: [], importCalls: {}, programCounters: []};
  const method = vm.top.method;
  let handle;
  try {
    handle = await prepareObserved(vm, observation);
    check(Object.isFrozen(handle) && handle.byteLength > 8, 'prepared managed heap method handle');
    equal(vm.instructions, 0, 'native preparation does not execute guest code');
    equal(observation.instantiations.length, 1, 'exactly one real native module was instantiated');
    const reference = collectRun(baseline, null, method.token);
    const actual = collectRun(vm, handle, method.token);
    equal(actual, reference, 'compiled and interpreted heap/GC/write/profile observations');
    const expectedCounters = method.instructions.map((instruction, index) => index);
    equal(actual.mainProgramCounters, expectedCounters, 'the entire selected method executed once');
    equal(observation.programCounters, expectedCounters,
      'every selected instruction actually crossed a native import, without interpreter-only fallback');
    // This guest has one import per selected instruction; its constructor remains interpreted.
    equal(observation.importCalls.allocate, 3, 'compiled newobj, newarr and ldstr allocation imports');
    equal(observation.importCalls.field, 3, 'compiled stfld, stsfld and ldfld imports');
    equal(observation.importCalls.array, 2, 'compiled stelem.ref and ldelem.ref imports');
    equal(observation.importCalls.call, 1, 'compiled return import');
    for (const kind of ['array', 'field', 'static']) check(actual.writes.some(write => write.kind === kind), kind + ' write notification');
    check(actual.heap.allocations >= 3 && actual.heap.collections >= actual.instructions + 1,
      'actual allocations and forced collection must be observed');
    return {passed: true, fixture: 'tests/support/wasm-heap-fixture.js', byteLength: handle.byteLength,
      nativeObservation: observation, nativeInstructionCount: observation.programCounters.length,
      selectedMethodInstructionCount: method.instructions.length, actual, reference};
  } finally {
    if (handle) disposeWasmMethod(handle);
    vm.stop();
    baseline.stop();
  }
}
