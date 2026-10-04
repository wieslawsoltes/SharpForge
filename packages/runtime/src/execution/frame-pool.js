import {sourceFramePreparation} from './source-frame-capability.js';
import {scrubPreparedSourceFrame} from './source-frame-scrub.js';
import {executionCodeState} from './code-version.js';
import {releaseFrameMemory} from './frame-memory-release.js';

const pools = new WeakMap();
const ownerOf = vm => vm.inspector ? executionCodeState(vm) : vm.image;
const arrays = new Set(['args', 'locals', 'stack', 'caught', 'unwinds']);

function storage(capacity) {
  const values = new Array(capacity).fill(undefined);
  values.length = 0;
  return values;
}

/** Reuse frame storage under a logical byte budget; this is not a JS heap-size estimate. */
class FramePool {
  #sourceBindings = new WeakMap();

  constructor(vm) {
    const limit = vm.options.framePoolBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid framePoolBytes');
    this.vm = vm;
    this.owner = ownerOf(vm);
    this.limit = limit;
    this.buckets = new WeakMap();
    this.entries = new WeakMap();
    this.pending = [];
    this.buffers = [];
    this.capacities = new WeakMap();
    this.bytes = 0;
    this.statistics = {framesAllocated: 0, arraysAllocated: 0, reused: 0, released: 0, cachedFrames: 0};
  }

  #bucketFor(method, argumentCount) {
    let sizes = this.buckets.get(method);
    if (!sizes) this.buckets.set(method, sizes = new Map());
    let capacities = sizes.get(argumentCount);
    if (!capacities) sizes.set(argumentCount, capacities = new Map());
    const cil = !!this.vm.inspector;
    const stack = cil ? Math.min(method.maxStack, this.vm.options.maxStackValues ?? 65536) : 0;
    let bucket = capacities.get(stack);
    if (!bucket) {
      const args = cil ? argumentCount : 0;
      const locals = cil ? method.locals.length : Math.max(method.locals.length, argumentCount);
      // Source frames use the VM's shared evaluation stack and need no per-frame capacity.
      if (![args, locals, stack].every(value => Number.isSafeInteger(value) && value >= 0)) {
        throw new TypeError('Invalid frame storage capacity');
      }
      bucket = {args, locals, stack, bytes: 128 + (args + locals + stack) * 8, free: []};
      capacities.set(stack, bucket);
    }
    return bucket;
  }

  acquire(method, argumentCount) {
    return this.#acquireBucket(this.#bucketFor(method, argumentCount), false);
  }

  /** The binding and its reusable storage belong to this pool, even when two VMs share source metadata. */
  acquireSource(capability) {
    if (this.vm.inspector || pools.get(this.vm) !== this || this.owner !== this.vm.image) {
      throw new TypeError('Prepared source frame pool is no longer current');
    }
    let binding = this.#sourceBindings.get(capability);
    const plan = binding?.plan ?? sourceFramePreparation(capability);
    if (!plan || plan.image !== this.owner || plan.method !== this.vm.image.methods[plan.methodId] ||
        plan.method.locals !== plan.locals || plan.method.locals.length !== plan.localCount) {
      throw new TypeError('Invalid prepared source frame storage capability');
    }
    if (!binding) {
      binding = {plan, bucket: this.#bucketFor(plan.method, plan.capacity)};
      this.#sourceBindings.set(capability, binding);
    }
    return this.#acquireBucket(binding.bucket, true);
  }

  #acquireBucket(bucket, preparedSource) {
    let frame = bucket.free.pop();
    if (frame) {
      this.bytes -= bucket.bytes;
      this.statistics.cachedFrames--;
      this.statistics.reused++;
      const entry = this.entries.get(frame);
      entry.retired = false;
      entry.preparedSource = preparedSource;
    } else {
      frame = {id: 0, method: undefined, methodId: undefined, args: storage(bucket.args),
        locals: storage(bucket.locals), stack: storage(bucket.stack), caught: [], unwinds: [],
        pc: 0, lastOffset: 0, offsets: undefined, base: 0, point: null, exception: null,
        pending: null, needsInitialization: false, rootCaptures: null};
      this.entries.set(frame, {bucket, retired: false, preparedSource});
      this.statistics.framesAllocated++;
      this.statistics.arraysAllocated += 5;
    }
    frame.args.length = bucket.args;
    frame.locals.length = bucket.locals;
    frame.pc = frame.lastOffset = 0;
    frame.point = frame.exception = frame.pending = null;
    frame.needsInitialization = false;
    return frame;
  }

  retire(frame) {
    releaseFrameMemory(this.vm, frame);
    const entry = this.entries.get(frame);
    if (!entry || entry.retired) return;
    entry.retired = true;
    this.pending.push(frame);
  }

  flush() {
    if (!this.pending.length) return;
    for (const frame of this.pending) {
      const entry = this.entries.get(frame);
      // Return/EH continuations finish reading the frame before this boundary.
      // Include late generic/delegate fields, without allocating Object.keys per return.
      if (entry.preparedSource) scrubPreparedSourceFrame(frame);
      else {
        for (const key in frame) {
          if (!Object.hasOwn(frame, key)) continue;
          if (arrays.has(key)) frame[key].length = 0;
          else frame[key] = undefined;
        }
      }
      this.statistics.released++;
      if (this.vm.options.framePooling !== false && entry.bucket.bytes <= this.limit - this.bytes) {
        entry.bucket.free.push(frame);
        this.bytes += entry.bucket.bytes;
        this.statistics.cachedFrames++;
      }
    }
    this.pending.length = 0;
  }

  arguments(stack, count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > stack.length) throw new TypeError('Invalid call argument count');
    let buffer = this.buffers.pop();
    if (buffer) this.bytes -= this.capacities.get(buffer) * 8;
    else { buffer = storage(count); this.statistics.arraysAllocated++; }
    this.capacities.set(buffer, Math.max(count, this.capacities.get(buffer) ?? 0));
    const start = stack.length - count;
    for (let index = 0; index < count; index++) buffer[index] = stack[start + index];
    stack.length = start;
    return buffer;
  }

  releaseArguments(buffer) {
    const capacity = Math.max(buffer.length, this.capacities.get(buffer));
    this.capacities.set(buffer, capacity);
    buffer.length = 0;
    if (this.vm.options.framePooling !== false && capacity * 8 <= this.limit - this.bytes && this.buffers.length < 16) {
      this.buffers.push(buffer);
      this.bytes += capacity * 8;
    }
  }
}

export function framePool(vm) {
  let pool = pools.get(vm);
  if (!pool || pool.owner !== ownerOf(vm)) pools.set(vm, pool = new FramePool(vm));
  return pool;
}

export function retirePooledFrame(vm, frame) {
  const pool = pools.get(vm);
  if (pool) pool.retire(frame);
  else releaseFrameMemory(vm, frame);
}
export function flushFramePool(vm) { pools.get(vm)?.flush(); }

/** Retired frames remain live until the enclosing return/EH callback reaches its flush. */
export function visitRetiredFrames(vm, visit) {
  const pending = pools.get(vm)?.pending;
  if (pending) for (const frame of pending) visit(frame);
}

/** Derived storage never enters snapshots or survives successful restore/stop. */
export function clearFramePool(vm) {
  pools.get(vm)?.flush();
  pools.delete(vm);
}

/** Deterministic pool counters; retainedBytes accounts logical slots, not host RSS. */
export function framePoolStatistics(vm) {
  const pool = framePool(vm);
  return Object.freeze({...pool.statistics, retainedBytes: pool.bytes});
}
