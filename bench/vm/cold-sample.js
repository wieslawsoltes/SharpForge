import {AssemblyInspector, loadAssembly, verifyCilAssembly} from '@sharpforge/cil';
import {verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {abortIfNeeded, runVM, assertOutput, managedMemory, hostMemory} from './operations.js';

/** One isolated cold observation; constructor verification remains visible instead of being subtracted. */
export async function coldSample(input, signal) {
  abortIfNeeded(signal);
  const {engine, artifact, fixture, vmOptions} = input;
  if (!['source', 'reloaded', 'cil'].includes(engine)) throw new TypeError('Unknown startup engine: ' + engine);
  const hostBefore = hostMemory();
  const started = performance.now();
  let at = started;
  const loaded = engine === 'cil' ? new AssemblyInspector(artifact.assembly) :
    engine === 'reloaded' ? loadAssembly(artifact.assembly) : structuredClone(artifact.image);
  const loadMs = performance.now() - at;
  at = performance.now();
  const verification = engine === 'cil' ? verifyCilAssembly(loaded, vmOptions) : verifyImage(loaded);
  const verificationMs = performance.now() - at;
  if (engine === 'cil' ? !verification.success : verification.length !== 0) {
    throw new Error('Startup verification failed: ' + JSON.stringify(verification));
  }
  let firstOutputAt = null;
  let processFirstOutputMs = null;
  const options = {...vmOptions, onOutput() {
    firstOutputAt ??= performance.now();
    processFirstOutputMs ??= process.uptime() * 1000;
  }};
  let vm;
  try {
    at = performance.now();
    vm = engine === 'cil' ? new CilVirtualMachine(loaded, options) : new VirtualMachine(loaded, options);
    const constructionMs = performance.now() - at;
    at = performance.now();
    const preparation = prepareExecution(vm);
    const preparationCallMs = performance.now() - at;
    if (!['prepared', 'not-required'].includes(preparation.status)) {
      throw new Error('Startup preparation unavailable: ' + preparation.reason);
    }
    const executionStarted = performance.now();
    await runVM(vm, signal);
    const executionMs = performance.now() - executionStarted;
    assertOutput(vm, fixture);
    if (firstOutputAt === null) throw new Error('Startup app never produced output');
    const memory = managedMemory(vm);
    return {loadMs, verificationMs, constructionMs, executionMs, preparationCallMs,
      ...(preparation.status === 'prepared' ? {predecodeMs: preparationCallMs} : {}),
      firstOutputExecutionMs: firstOutputAt - executionStarted, timeToFirstOutputMs: firstOutputAt - started,
      processFirstOutputMs, preparation, managedAllocations: memory.allocations, managedAllocatedBytes: memory.allocatedBytes,
      hostBefore, hostAfter: hostMemory(), outputVerified: true};
  } finally { vm?.stop(); }
}
