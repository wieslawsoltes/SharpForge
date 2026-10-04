import {FORMAT_VERSION, Op} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, isReference, prepareExecution} from '@sharpforge/runtime';
import {qualificationAssembly} from './qualification-assembly.js';
import {qualificationVmOptions, checkQualificationLimit} from './qualification-execution.js';
import {hostMemory, samplePhase} from './operations.js';
import {distribution} from './statistics.js';
import {pairedTarget} from './qualification-statistics.js';
import {hash, stable} from './evidence.js';
import {requireQualificationOptions} from './qualification-options.js';

const frames = 500, scalarLocals = 32;
const types = [...Array(scalarLocals).fill('int'), 'object'];

function sourceImage() {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [0], types: [], statics: [], sequencePoints: [], sources: [],
    methods: [{id: 0, name: 'Main', qualifiedName: 'Main', owner: null, isStatic: true, returnType: 'int',
      parameters: [], handlers: [], locals: types.map((type, slot) => ({type, slot, name: 'local' + slot})),
      code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])}]};
}

function liveStack(engine, options) {
  const vmOptions = {...qualificationVmOptions(options), preciseRoots: true, maxFrames: frames + 1};
  const artifact = engine === 'source' ? sourceImage()
    : qualificationAssembly({name: 'RootInventory', locals: types, body: writer => writer.integer(0).op('ret')});
  const vm = engine === 'source' ? new VirtualMachine(artifact, vmOptions) : new CilVirtualMachine(artifact, vmOptions);
  try {
    prepareExecution(vm);
    const entry = engine === 'source' ? vm.top.methodId : vm.top.method.token;
    const references = [];
    for (let index = 0; index < frames; index++) {
      if (index) vm.call(entry, []);
      vm.top.locals.fill(42, 0, scalarLocals);
      const reference = vm.heap.object('object', []);
      references.push(reference);
      vm.top.locals[scalarLocals] = reference;
    }
    vm.heap.collect();
    for (const reference of references) vm.heap.get(reference);
    return {vm, references, artifactHash: hash(engine === 'source' ? stable(artifact) : artifact)};
  } catch (error) { vm.stop(); throw error; }
}

function inventory(vm, precise) {
  vm.options.preciseRoots = precise;
  const references = [];
  const visit = value => { if (isReference(value)) references.push(`${value.h}:${value.g}`); };
  const iterable = vm.heap.rootProvider(visit);
  if (iterable !== undefined) for (const value of iterable) visit(value);
  return references;
}

function scanObserver(vm, references) {
  let visited = 0, managed = 0, checksum = 0;
  const expectedChecksum = references.reduce((sum, reference) => sum + reference.h, 0);
  const visit = value => {
    visited++;
    if (isReference(value)) { managed++; checksum += value.h; }
  };
  return scans => {
    visited = managed = checksum = 0;
    const hostBefore = hostMemory(), started = performance.now();
    for (let index = 0; index < scans; index++) {
      const iterable = vm.heap.rootProvider(visit);
      if (iterable !== undefined) for (const value of iterable) visit(value);
    }
    const scanMs = performance.now() - started;
    if (managed !== references.length * scans || checksum !== expectedChecksum * scans) {
      throw new Error('Root scan changed the live managed-reference inventory');
    }
    return {scanMs, scans, visited, managed, checksum, hostBefore, hostAfter: hostMemory(), inventoryVerified: true};
  };
}

/** Real VM call frames, one live reference and 32 canonical Int32 locals per frame; construction is outside scan timers. */
export async function measureRootQualification(engine, options, signal) {
  requireQualificationOptions(options);
  if (!['source', 'cil'].includes(engine)) throw new TypeError('Root qualification requires source or cil');
  const scans = options.rootScans ?? 20;
  if (!Number.isInteger(scans) || scans < 1 || scans > 1000) throw new RangeError('Root scan batch must be 1–1000');
  const {vm, references, artifactHash} = liveStack(engine, options);
  const row = {id: 'root-visitor-' + engine, issue: 1400, engine, frames, scalarLocals, referenceLocals: 1,
    artifactHash, scansPerObservation: scans, status: 'running', samples: {baseline: [], candidate: []},
    construction: '500 calls through the real verified VM call API; no synthesized frame objects',
    vmOptions: {...qualificationVmOptions(options), maxFrames: frames + 1},
    baseline: 'preciseRoots:false iterator', candidate: 'preciseRoots:true visitor; liveness pruning disabled'};
  try {
    if (stable(inventory(vm, false)) !== stable(inventory(vm, true))) throw new Error('Root modes disagree before timing');
    const observe = scanObserver(vm, references), deadline = performance.now() + options.timeoutSeconds * 1000;
    for (let index = 0; index < options.samples + options.warmup + 1; index++) {
      for (const mode of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        checkQualificationLimit(deadline, signal);
        vm.options.preciseRoots = mode === 'candidate';
        globalThis.gc?.();
        row.samples[mode].push({index, phase: samplePhase(index, options.warmup), ...observe(scans)});
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    const observations = mode => row.samples[mode].filter(sample => sample.phase === 'measured').map(sample => sample.scanMs);
    row.summary = Object.fromEntries(['baseline', 'candidate'].map(mode => [mode, {scanMs: distribution(observations(mode))}]));
    row.target = pairedTarget(observations('baseline'), observations('candidate'), {kind: 'minimum-speedup', value: 3},
      {seed: options.seed, resamples: options.resamples});
    for (const preciseRoots of [false, true]) {
      vm.options.preciseRoots = preciseRoots;
      vm.heap.collect();
      for (const reference of references) vm.heap.get(reference);
    }
    row.collectionVerified = true;
    row.status = 'measured';
    return row;
  } catch (error) {
    row.status = signal?.aborted ? 'cancelled' : 'failed';
    error.evidence = row;
    throw error;
  } finally { vm.stop(); }
}
