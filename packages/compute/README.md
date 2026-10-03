# @sharpforge/compute — 0.14.0

Independently usable numerical kernels and an isolated browser/Node worker pool. MIT; no runtime dependency on a CDN or compiler toolchain. The checked-in WebAssembly module is built from the included C source, not an external binary dependency.

```js
import {createSimdEngine, ComputePool} from '@sharpforge/compute';
const engine = createSimdEngine({backend: 'auto'});
console.log(engine.execute('dot', new Float64Array([2, 3]), new Float64Array([10, 8]))); // 44
console.log(engine.metrics); // actual backend and copy/call metrics
const pool = new ComputePool({workers: 2, maxQueue: 32, maxQueuedBytes: 64 * 1024 * 1024});
try {
  await pool.init();
  console.log(await pool.execute('sum', new Float64Array([20, 22]))); // 42
  console.log(await pool.capabilities());
} finally { pool.dispose(); }
```

`createSimdEngine({backend:'auto'|'wasm'|'scalar', maxElements:1000000})` accepts Int32Array or Float64Array. Inputs to binary operations must have the same type and length. Operations: add, subtract, multiply, min, max, sum, dot; double divide; int and/xor. Output vectors are owned typed arrays, reductions are numbers. Int operations wrap to int32. Reductions use the same fixed lane order in scalar and SIMD paths; they are not promised to match a sequential floating-point sum. NaN, infinity, signed zero, remainders and empty input have tests.

The real SIMD module uses i32x4/f64x2 operations. `wasm` requires successful SIMD validation/instantiation and fails otherwise; `auto` reports a scalar fallback and reason; `scalar` disables WASM. Selected SIMD does not prove a particular CPU instruction mapping. Tiny vectors may be slower through the WASM boundary. Inputs are copied to bounded linear memory and output is copied back: this is not zero-copy managed heap execution. Up to 1,000,000 elements per call; module memory is bounded to 64 MiB.

`ComputePool.execute(operation,a,b=null,{signal,timeoutMs})` uses real `worker_threads` in Node or Blob workers in browsers. Its implementation ships only the closed numerical kernel; it does not accept user callback code. Caller buffers are copied before transferring the owned copies; caller mutation and buffer lifetime cannot race a worker. Worker outputs transfer back. There is no SharedArrayBuffer, managed heap sharing, cross-origin isolation requirement, or C# OS-thread implementation.

Defaults: two workers (1–8), 32 queued jobs (up to 1024), 1,000,000 elements/job, 30 second deadline (up to 10 minutes), 64 MiB active-plus-queued input bytes (configurable up to 512 MiB). Deadlines include queuing/startup and are checked when results arrive as well as by timers. Cancellation removes queued jobs or terminates/replaces the running worker; stale results are ignored. Startup handshake failures and disposal reject pending work. A job's storage is released on every completion/error/cancel path. Metrics include actual backend, worker identities where available, peak active jobs, bytes, completions and failures.

Node >=22 or a browser with typed arrays and workers. Browsers need CSP `worker-src 'self' blob:` and `script-src 'self' 'wasm-unsafe-eval'` for the WASM path. The standalone build embeds the same kernel and worker factory. Browser policy may still forbid local-file workers. Kernel regeneration from the source repository: `bash scripts/build-simd.sh` (tested clang 17); normal builds use checked-in bytes. No physical WebGPU is involved in this CPU numerical package.
