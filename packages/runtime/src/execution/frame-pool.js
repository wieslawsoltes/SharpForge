import {releaseTypedNumericFrame} from './typed-numeric-frame.js';
import {sourceStackSlots} from './source-stack-size.js';

const emptyArrays = new Set(['args', 'locals', 'stack', 'caught', 'unwinds']);

function limit(vm) {
  const bytes = vm.options.framePoolBytes ?? vm.options.maxStackBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('framePoolBytes must be a nonnegative safe integer');
  return bytes;
}

function storage(capacity) {
  const values = new Array(capacity).fill(undefined);
  values.length = 0;
  return values;
}

/** Reusable execution storage. Capacity is a logical slot bound, not a JS heap-size estimate. */
export class FramePool {
  constructor(vm) {
    this.vm = vm;
    this.limit = limit(vm);
    this.owner = vm.inspector ?? vm.image;
    this.buckets = new WeakMap();
    this.entries = new WeakMap();
    this.pending = [];
    this.cached = new Set();
    this.argumentBuffers = [];
    this.argumentCapacities = new WeakMap();
    this.argumentBytes = 0;
    this.bytes = 0;
    this.statistics = {framesAllocated: 0, arraysAllocated: 0, reused: 0, released: 0, retainedSlots: 0};
  }

  acquire(method, optionalCount = 0) {
    let sizes = this.buckets.get(method);
    if (!sizes) {
      const cil = !!method.signature;
      const stack = cil ? method.maxStack : sourceStackSlots(method, this.vm.image.constants);
      if (!Number.isSafeInteger(stack) || stack < 0 || cil && stack > 65535) throw new TypeError('Invalid verified maxstack');
      sizes = {args: cil ? method.signature.parameters.length + Number(!method.signature.isStatic) : 0,
        locals: method.locals.length, stack, optional: new Map()};
      this.buckets.set(method, sizes);
    }
    let bucket = sizes.optional.get(optionalCount);
    if (!bucket) {
      const cil = !!method.signature;
      bucket = {args: sizes.args + (cil ? optionalCount : 0), locals: sizes.locals + (cil ? 0 : optionalCount),
        stack: sizes.stack, free: []};
      bucket.slots = bucket.args + bucket.locals + bucket.stack;
      bucket.bytes = 128 + bucket.slots * 8;
      sizes.optional.set(optionalCount, bucket);
    }
    let frame = bucket.free.pop();
    if (frame) {
      this.cached.delete(frame);
      this.bytes -= bucket.bytes;
      this.statistics.retainedSlots -= bucket.slots;
      this.statistics.reused++;
    } else {
      frame = {id: 0, method: undefined, methodId: undefined, args: storage(bucket.args), locals: storage(bucket.locals),
        stack: storage(bucket.stack), pc: 0, lastOffset: 0, offsets: undefined, base: 0, point: null,
        exception: null, pending: null, caught: [], unwinds: [], needsInitialization: false};
      this.entries.set(frame, {bucket, retired: false});
      this.statistics.framesAllocated++;
      this.statistics.arraysAllocated += 5;
    }
    frame.locals.length = bucket.locals;
    return frame;
  }

  retire(frame) {
    const entry = this.entries.get(frame);
    if (!entry || entry.retired) return;
    entry.retired = true;
    this.pending.push(frame);
  }

  flush() {
    for (const frame of this.pending) {
      const entry = this.entries.get(frame);
      releaseTypedNumericFrame(frame);
      // Keep late-added call/continuation fields covered without allocating a
      // keys array on every return. Inherited properties are not frame state.
      for (const key in frame) {
        if (!Object.hasOwn(frame, key)) continue;
        if (emptyArrays.has(key)) frame[key].length = 0;
        else frame[key] = undefined;
      }
      this.statistics.released++;
      if (entry.bucket.bytes <= this.limit - this.bytes - this.argumentBytes && this.vm.options.framePooling !== false) {
        entry.retired = false;
        entry.bucket.free.push(frame);
        this.cached.add(frame);
        this.bytes += entry.bucket.bytes;
        this.statistics.retainedSlots += entry.bucket.slots;
      }
    }
    this.pending.length = 0;
  }

  arguments(stack, count, remove = true) {
    let buffer = this.argumentBuffers.pop();
    if (buffer) this.argumentBytes -= this.argumentCapacities.get(buffer) * 8;
    else { buffer = storage(count); this.statistics.arraysAllocated++; }
    this.argumentCapacities.set(buffer, Math.max(count, this.argumentCapacities.get(buffer) ?? 0));
    const start = stack.length - count;
    for (let index = 0; index < count; index++) buffer[index] = stack[start + index];
    if (remove) stack.length = start;
    return buffer;
  }

  releaseArguments(buffer) {
    const slots = this.argumentCapacities.get(buffer);
    buffer.length = 0;
    if (slots * 8 <= this.limit - this.bytes - this.argumentBytes && this.argumentBuffers.length < 16) {
      this.argumentBuffers.push(buffer);
      this.argumentBytes += slots * 8;
    }
  }
}

export function framePool(vm) {
  const owner = vm.inspector ?? vm.image;
  if (!vm.framePool || vm.framePool.owner !== owner) vm.framePool = new FramePool(vm);
  return vm.framePool;
}

/** Callers finish inspecting popped frame continuations before this instruction boundary. */
export function flushFramePool(vm) {
  if (!vm.framePool) return;
  vm.framePool.activeFrame = null;
  vm.framePool.flush();
}

export function beginFrameInstruction(vm, frame) {
  framePool(vm).activeFrame = frame;
}

export function retirePooledFrame(vm, frame) {
  vm.framePool?.retire(frame);
}

export function clearFramePool(vm) {
  if (!vm.framePool) return;
  vm.framePool.flush();
  vm.framePool = new FramePool(vm);
}

/** Read deterministic allocation counters without running GC or sampling host memory. */
export function framePoolStatistics(vm) {
  return {...framePool(vm).statistics, retainedBytes: vm.framePool.bytes + vm.framePool.argumentBytes};
}
