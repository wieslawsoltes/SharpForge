import test from 'node:test';
import assert from 'node:assert/strict';
import {wasmExecution, debuggerDeopt, cspDeniedFallback} from './fixtures/a05-browser/runtime.mjs';
import {profileExports} from './fixtures/a05-browser/profiles.mjs';
import {wasmHeapBridge} from './fixtures/a05-browser/heap.mjs';

// Node verifies fixture assertions only. This suite cannot establish a browser,
// CSP, or Speedscope UI result; those require the separate Python browser runner.
test('browser Wasm fixture requires native arithmetic and preserves exact instruction/profile totals', async () => {
  const result = await wasmExecution();
  assert.equal(result.passed, true);
  assert.deepEqual(result.nativeProbe, {moduleHex: '0061736d01000000', compiled: true, nativeModule: true});
  assert.equal(result.hostArithmeticCalls, 0);
  assert(result.instructions > 0);
  assert.equal(result.instructions, result.referenceInstructions);
});

test('browser debugger fixture proves OSR, actual breakpoint, canonical step, and interpreted resume', async () => {
  const result = await debuggerDeopt();
  assert.equal(result.passed, true);
  assert.deepEqual(result.stopped, {pc: 3, locals: [3], stack: [3]});
  assert.equal(result.statistics.osrTransitions, 1);
  assert(result.hostArithmeticCalls > 0);
});

test('browser profile fixtures export actual source/reload/CIL counts and named guest methods', () => {
  const result = profileExports();
  assert.equal(result.passed, true);
  assert.deepEqual(result.exports.map(item => item.engine), ['source', 'reload', 'cil']);
  for (const item of result.exports) {
    assert.equal(item.file.profiles[0].endValue, item.instructions);
    assert.equal(item.methods.reduce((sum, method) => sum + method.self, 0), item.instructions);
    assert(item.methods.some(method => method.name.includes('A05BrowserTwice')));
    assert(item.methods.some(method => method.name.includes('Main')));
    assert(item.instructions < 1000, 'UI raw instruction counts stay unambiguous');
  }
});

test('browser native arithmetic fixture fails when a required WebAssembly dependency is unavailable', async () => {
  const original = globalThis.WebAssembly;
  try {
    globalThis.WebAssembly = undefined;
    await assert.rejects(wasmExecution(), /actual browser WebAssembly is required/);
  } finally { globalThis.WebAssembly = original; }
});

test('denial fixture cannot pass when native compilation is actually allowed', async () => {
  await assert.rejects(cspDeniedFallback(), /denied CSP rejects a valid native module/);
});

test('browser heap fixture executes native allocation/field/array imports with GC, write and profile parity', async () => {
  const result = await wasmHeapBridge();
  assert.equal(result.passed, true);
  assert.equal(result.nativeObservation.instantiations.length, 1);
  assert.equal(result.nativeInstructionCount, result.selectedMethodInstructionCount);
  assert.equal(result.nativeObservation.importCalls.allocate, 3);
  assert.equal(result.nativeObservation.importCalls.field, 3);
  assert.equal(result.nativeObservation.importCalls.array, 2);
  assert.equal(result.actual.result, 'rooted');
  assert.equal(result.actual.instructions, result.actual.safepointCollections);
  assert.deepEqual(result.actual.returnRootProbe, {survivedWithRoot: true, collectedWithoutRoot: true, extraCollections: 1});
  assert.deepEqual(result.actual, result.reference);
  for (const kind of ['array', 'field', 'static']) assert(result.actual.writes.some(write => write.kind === kind));
});

test('browser heap fixture cannot qualify without the actual WebAssembly backend', async () => {
  const original = globalThis.WebAssembly;
  try {
    globalThis.WebAssembly = undefined;
    await assert.rejects(wasmHeapBridge(), /actual browser WebAssembly is required/);
  } finally { globalThis.WebAssembly = original; }
});

test('browser heap observer restores the incoming native property after compilation refusal', async () => {
  const backend = globalThis.WebAssembly;
  const original = Object.getOwnPropertyDescriptor(backend, 'instantiate');
  const refusal = async () => { throw new backend.CompileError('intentional fixture refusal'); };
  const incoming = {...original, value: refusal};
  Object.defineProperty(backend, 'instantiate', incoming);
  try {
    await assert.rejects(wasmHeapBridge(), error => error.code === 'WASM_COMPILE');
    assert.deepEqual(Object.getOwnPropertyDescriptor(backend, 'instantiate'), incoming);
  } finally { Object.defineProperty(backend, 'instantiate', original); }
});
