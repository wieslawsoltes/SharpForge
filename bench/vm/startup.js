import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {serialize, deserialize} from 'node:v8';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AssemblyInspector, loadAssembly, verifyCilAssembly} from '@sharpforge/cil';
import {verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {abortIfNeeded, runVM, assertOutput, managedMemory, hostMemory} from './operations.js';
import {finalizeRow, measuredMetric, isMain} from './evidence.js';

/** A fresh process performs exactly one cold sample; disk input and repeated constructor verification stay visible. */
export async function coldSample(input, signal) {
  const {engine, artifact, fixture, vmOptions} = input;
  const hostBefore = hostMemory(), started = performance.now();
  let loaded, at = started;
  if (engine === 'cil') loaded = new AssemblyInspector(artifact.assembly);
  else loaded = engine === 'reloaded' ? loadAssembly(artifact.assembly) : structuredClone(artifact.image);
  const loadMs = performance.now() - at;
  at = performance.now();
  const verification = engine === 'cil' ? verifyCilAssembly(loaded, vmOptions) : verifyImage(loaded);
  const verificationMs = performance.now() - at;
  if (engine === 'cil' ? !verification.success : verification.length !== 0) throw new Error('Startup verification failed');
  let firstOutputAt = null, processFirstOutputMs = null;
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
    const preparation = prepareExecution(vm), predecodeMs = performance.now() - at;
    if (preparation.status !== 'prepared') throw new Error('Startup predecode unavailable: ' + preparation.reason);
    const executionStarted = performance.now();
    await runVM(vm, signal);
    const executionMs = performance.now() - executionStarted;
    assertOutput(vm, fixture);
    if (firstOutputAt === null) throw new Error('Startup app never produced output');
    return {loadMs, verificationMs, constructionMs, predecodeMs, executionMs,
      firstOutputExecutionMs: firstOutputAt - executionStarted, timeToFirstOutputMs: firstOutputAt - started,
      processFirstOutputMs, preparation, ...Object.fromEntries(Object.entries(managedMemory(vm)).map(([key, value]) =>
        [key === 'allocations' ? 'managedAllocations' : 'managedAllocatedBytes', value])),
      hostBefore, hostAfter: hostMemory(), outputVerified: true};
  } finally { vm?.stop(); }
}

function childSample(input, signal) {
  abortIfNeeded(signal);
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-vm-cold-'));
  const path = join(directory, 'input.bin');
  try { writeFileSync(path, serialize(input)); }
  catch (error) { rmSync(directory, {recursive: true, force: true}); throw error; }
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--worker', path],
      {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', errors = '', failure = null;
    const cancel = () => { failure = signal.reason ?? new DOMException('Cancelled', 'AbortError'); child.kill('SIGTERM'); };
    const timeout = setTimeout(() => { failure = new Error('Cold sample exceeded 120 seconds'); child.kill('SIGKILL'); }, 120000);
    signal?.addEventListener('abort', cancel, {once: true});
    const append = (chunk, error) => {
      if (error) errors += chunk; else output += chunk;
      if (output.length + errors.length > 2000000) { failure = new Error('Cold worker output limit exceeded'); child.kill('SIGKILL'); }
    };
    child.stdout.on('data', chunk => append(chunk, false));
    child.stderr.on('data', chunk => append(chunk, true));
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      rmSync(directory, {recursive: true, force: true});
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Cold worker failed (${code}): ${errors || output}`));
      try { resolve({...JSON.parse(output), childProcessMs: performance.now() - start}); }
      catch (error) { reject(new Error('Malformed cold worker report: ' + error.message)); }
    });
  });
}

export async function measureStartup(fixture, engine, artifact, protocol, signal, onRow = () => {}) {
  const timings = ['loadMs', 'verificationMs', 'constructionMs', 'predecodeMs', 'firstOutputExecutionMs',
    'timeToFirstOutputMs', 'processFirstOutputMs', 'childProcessMs'];
  const row = {id: `startup/${fixture.id}/${engine}`, kind: 'startup', engine, fixture: fixture.id,
    isolation: 'fresh-node-process-per-sample', samples: [], metrics: {
      ...Object.fromEntries(timings.map(key => [key, measuredMetric('ms')])),
      managedAllocations: measuredMetric('objects', ['median']), managedAllocatedBytes: measuredMetric('bytes', ['median']),
    }};
  onRow(row);
  for (let index = 0; index < protocol.samples; index++) {
    const sample = await childSample({fixture, engine, artifact, vmOptions: protocol.vmOptions}, signal);
    row.samples.push({index, phase: 'measured', ...sample});
  }
  return finalizeRow(row);
}

if (isMain(import.meta.url)) {
  if (process.argv[2] !== '--worker' || !process.argv[3]) throw new Error('Use node bench/vm/harness.js; startup is an isolated worker');
  try {
    const at = performance.now(), input = deserialize(readFileSync(process.argv[3]));
    const inputReadDeserializeMs = performance.now() - at;
    process.stdout.write(JSON.stringify({...await coldSample(input), inputReadDeserializeMs}));
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}
