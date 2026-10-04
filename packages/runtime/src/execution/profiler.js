// Observations belong to the host VM lifetime, outside its rewindable execution graph.
const profilers = new WeakMap();
const options = new Set(['maxMethods', 'maxStacks', 'maxSites', 'maxStackDepth', 'sampleBudget']);

function limit(value, fallback, name, minimum = 1) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > 1_000_000) {
    throw new RangeError('Invalid profiler ' + name);
  }
  return value;
}

function methodRecord(id, name) {
  return {id, name, calls: 0, instructions: 0, inclusiveInstructions: 0, allocations: 0, allocatedBytes: 0};
}

/** Bounded instruction weights, not elapsed time. No sample retains a frame or managed value. */
class ExecutionProfiler {
  constructor(vm, configuration) {
    this.vm = vm;
    this.maxMethods = limit(configuration.maxMethods, 65536, 'method limit', 2);
    this.maxStacks = limit(configuration.maxStacks, 16384, 'stack limit', 2);
    this.maxSites = limit(configuration.maxSites, 16384, 'allocation-site limit');
    this.maxStackDepth = limit(configuration.maxStackDepth, 512, 'stack depth');
    this.sampleBudget = limit(configuration.sampleBudget, 256, 'sample budget');
    this.methods = [methodRecord(0, '[runtime]'), methodRecord(1, '[profile capacity]')];
    this.methodIds = new WeakMap();
    this.methodBodies = new WeakMap();
    this.executedFrames = new WeakMap();
    this.samples = [];
    this.stackIds = new Map();
    this.sites = new Map();
    this.allocationSites = [];
    this.pending = null;
    this.instructions = 0;
    this.allocations = 0;
    this.allocatedBytes = 0;
    this.overflow = {methods: 0, stackInstructions: 0, stackDepthInstructions: 0, allocationBytes: 0, allocationCount: 0};
  }

  method(frame) {
    const method = frame?.method ?? this.vm.image?.methods[frame?.methodId];
    if (!method) return 0;
    const owner = this.vm.inspector ?? this.vm.image, body = method.instructions ?? method.code;
    const type = method.genericIdentity, arguments_ = method.methodArguments;
    const previous = this.methodIds.get(method);
    if (previous?.owner === owner && previous.body === body && previous.type === type && previous.arguments === arguments_) {
      return previous.id;
    }
    let bodies = this.methodBodies.get(owner), contexts = bodies?.get(body);
    // Instantiated method objects are recreated after restore; their canonical body and closed context remain stable.
    const key = this.vm.inspector ? JSON.stringify([method.token, type ?? null, arguments_ ?? []]) : method.id;
    let id = contexts?.get(key);
    if (id === undefined) {
      id = 1;
      if (this.methods.length < this.maxMethods) {
        id = this.methods.length;
        const name = this.vm.inspector ? (type ?? method.owner) + '::' + method.name +
          (arguments_?.length ? '<' + arguments_.join(',') + '>' : '') : method.qualifiedName ?? method.owner + '::' + method.name;
        this.methods.push(methodRecord(id, name.slice(0, 4096)));
        if (!bodies) this.methodBodies.set(owner, bodies = new WeakMap());
        if (!contexts) bodies.set(body, contexts = new Map());
        contexts.set(key, id);
      } else this.overflow.methods++;
    }
    this.methodIds.set(method, {owner, body, type, arguments: arguments_, id});
    return id;
  }

  enter(frame) {
    this.boundary();
    if (!frame.filterSearch) this.methods[this.method(frame)].calls++;
  }

  sample(frame, method) {
    const frames = this.vm.frames;
    const truncated = frames.length > this.maxStackDepth;
    const start = truncated ? frames.length - this.maxStackDepth + 1 : 0;
    const stack = truncated ? [1] : [];
    for (let index = start; index < frames.length; index++) {
      if (!frames[index].filterSearch) stack.push(this.method(frames[index]));
    }
    if (!stack.length) stack.push(method);
    const key = stack.join(',');
    let sample = this.stackIds.get(key);
    if (!sample && this.samples.length < this.maxStacks - 1) {
      sample = {stack, weight: 0};
      this.stackIds.set(key, sample);
      this.samples.push(sample);
    }
    const overflow = !sample;
    if (overflow) {
      sample = this.samples[this.maxStacks - 1] ??= {stack: [1], weight: 0};
    }
    return {frameId: frame.id, method, stack, sample, overflow, truncated, weight: 0};
  }

  /** One charge immediately before an opcode handler, including handlers that subsequently fault. */
  instruction(frame) {
    if (this.executedFrames.get(frame) !== frame.id) this.executedFrames.set(frame, frame.id);
    const method = this.method(frame);
    if (this.pending?.frameId !== frame.id || this.pending.method !== method) {
      this.boundary();
      this.pending = this.sample(frame, method);
    }
    this.instructions++;
    this.methods[method].instructions++;
    this.pending.weight++;
    if (this.pending.weight >= this.sampleBudget) this.flushSample();
  }

  flushSample() {
    const pending = this.pending;
    if (!pending?.weight) return;
    for (const method of pending.stack) this.methods[method].inclusiveInstructions += pending.weight;
    pending.sample.weight += pending.weight;
    if (pending.overflow) this.overflow.stackInstructions += pending.weight;
    if (pending.truncated) this.overflow.stackDepthInstructions += pending.weight;
    pending.weight = 0;
  }

  /** Called at slice/restore/stop boundaries; pending numeric samples never outlive a pooled frame identity. */
  boundary() {
    this.flushSample();
    this.pending = null;
  }

  allocation(bytes, resize = false) {
    const frame = this.vm.top, method = this.method(frame), counts = this.methods[method];
    const atEntry = frame?.pc === 0 && this.executedFrames.get(frame) !== frame.id;
    const offset = !frame || atEntry ? -1 : frame.method ? frame.lastOffset : frame.pc - 1;
    let offsets = this.sites.get(method), site = offsets?.get(offset);
    if (!site && this.allocationSites.length < this.maxSites) {
      if (!offsets) this.sites.set(method, offsets = new Map());
      site = {method, offset, allocations: 0, bytes: 0};
      offsets.set(offset, site);
      this.allocationSites.push(site);
    }
    if (!resize) {
      this.allocations++;
      counts.allocations++;
      if (site) site.allocations++;
      else this.overflow.allocationCount++;
    }
    this.allocatedBytes += bytes;
    counts.allocatedBytes += bytes;
    if (site) site.bytes += bytes;
    else this.overflow.allocationBytes += bytes;
  }

  /** Independent counter view. Totals are cumulative host observations and never rewind with VM snapshots. */
  read() {
    this.flushSample();
    return {format: 'SharpForge.InstructionProfile/1', clock: 'instructions', instructions: this.instructions,
      allocations: this.allocations, allocatedBytes: this.allocatedBytes, sampleBudget: this.sampleBudget,
      overflow: {...this.overflow}, methods: this.methods.map(method => ({...method})),
      samples: this.samples.map(sample => ({stack: [...sample.stack], weight: sample.weight})),
      allocationSites: this.allocationSites.map(site => ({...site}))};
  }
}

export function initializeExecutionProfiler(vm, option) {
  if (option === undefined || option === false) return;
  if (option !== true && (!option || typeof option !== 'object' || Array.isArray(option))) {
    throw new TypeError('profile must be a boolean or profiler options');
  }
  const configuration = option === true ? {} : option;
  for (const key of Object.keys(configuration)) {
    if (!options.has(key)) throw new TypeError('Unsupported profiler option: ' + key);
  }
  const profiler = new ExecutionProfiler(vm, configuration);
  profilers.set(vm, profiler);
  vm.heap.allocationObserver = profiler;
}

export function executionProfiler(vm) {
  return profilers.get(vm) ?? null;
}

/** Read bounded instruction/call/allocation counters, or null when profiling was not enabled at construction. */
export function instructionProfile(vm) {
  return executionProfiler(vm)?.read() ?? null;
}
