import {RuntimeEventLog, RuntimeEventName} from './runtime-events.js';
import {createProfilerClock} from './profiler-clock.js';

function limit(value, fallback, name, maximum = 1_000_000) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 2 || value > maximum) throw new RangeError('Invalid profiler ' + name);
  return value;
}

function methodRecord(id, name) {
  return {id, name, calls: 0, instructions: 0, inclusiveInstructions: 0,
    exclusiveMilliseconds: 0, inclusiveMilliseconds: 0, allocations: 0, allocatedBytes: 0};
}

/** Bounded instruction and duration observations; totals do not rewind with VM snapshots. */
export class ExecutionProfiler {
  constructor(vm, options = {}) {
    this.vm = vm;
    this.maxMethods = limit(options.maxMethods, 65536, 'method limit');
    this.maxStacks = limit(options.maxStacks, 16384, 'stack limit');
    this.maxSites = limit(options.maxSites, 16384, 'allocation-site limit');
    this.sampleBudget = limit(options.sampleBudget, 256, 'sample budget');
    this.durationClock = createProfilerClock(options);
    this.events = new RuntimeEventLog(options.events);
    this.methods = [methodRecord(0, '[runtime]'), methodRecord(1, '[profile capacity]')];
    this.methodIds = new WeakMap();
    this.samples = [];
    this.stackIds = new Map();
    this.sites = new Map();
    this.pending = null;
    this.instructions = 0;
    this.allocations = 0;
    this.allocatedBytes = 0;
    this.suspensions = 0;
    this.waitingContexts = new Set();
    this.methodOverflow = 0;
    this.stackOverflow = 0;
    this.stackDurationOverflow = 0;
    this.siteOverflow = 0;
    this.lastState = vm.state;
  }

  method(frame) {
    const method = frame?.method ?? this.vm.image?.methods[frame?.methodId];
    if (!method) return 0;
    const previous = this.methodIds.get(method);
    if (previous !== undefined) return previous;
    let id = 1;
    if (this.methods.length < this.maxMethods) {
      id = this.methods.length;
      const name = method.qualifiedName ?? method.owner + '::' + method.name;
      this.methods.push(methodRecord(id, name.slice(0, 4096)));
      this.event(RuntimeEventName.MethodLoad, {method: id, name: this.methods[id].name});
    } else this.methodOverflow++;
    this.methodIds.set(method, id);
    return id;
  }

  event(name, payload) {
    return this.events.emit(name, payload, this.instructions);
  }

  enter(frame) {
    this.flushSample();
    if (frame.filterSearch) return;
    const method = this.method(frame);
    this.methods[method].calls++;
    this.event(RuntimeEventName.MethodEnter, {method, frame: frame.id, context: this.vm.scheduler?.currentId ?? 0});
  }

  leave(frame) {
    this.flushSample();
    if (!frame.filterSearch) this.event(RuntimeEventName.MethodLeave, {method: this.method(frame), frame: frame.id});
  }

  /** Called only when enabled; continuations supply the number of bounded work units actually executed. */
  instruction(frame, weight = 1) {
    if (!weight) return;
    this.instructions += weight;
    const method = this.method(frame);
    this.methods[method].instructions += weight;
    if (this.pending?.frame !== frame) this.flushSample();
    if (!this.pending) {
      const stack = this.vm.frames.filter(item => !item.filterSearch).map(item => this.method(item));
      this.pending = {frame, method, stack: stack.length ? stack : [method], weight: 0,
        startedAt: this.durationClock?.read()};
    }
    this.pending.weight += weight;
    if (this.pending.weight >= this.sampleBudget) this.flushSample(true);
  }

  flushSample(continueTiming = false) {
    const sample = this.pending;
    if (!sample) return;
    const now = this.durationClock?.read();
    const milliseconds = this.durationClock ? now - sample.startedAt : 0;
    if (this.durationClock) this.durationClock.record(milliseconds);
    // Instruction hooks run before dispatch. A budget flush must keep measuring
    // the following work even if call/return/boundary is the next profiler hook.
    this.pending = continueTiming && this.durationClock ? {...sample, weight: 0, startedAt: now} : null;
    this.methods[sample.method].exclusiveMilliseconds += milliseconds;
    for (const method of sample.stack) {
      this.methods[method].inclusiveInstructions += sample.weight;
      this.methods[method].inclusiveMilliseconds += milliseconds;
    }
    const key = sample.stack.join(',');
    let index = this.stackIds.get(key);
    if (index === undefined) {
      if (this.samples.length < this.maxStacks - 1) {
        index = this.samples.length;
        this.samples.push({stack: sample.stack, weight: 0, milliseconds: 0});
        this.stackIds.set(key, index);
      } else {
        this.stackOverflow += sample.weight;
        this.stackDurationOverflow += milliseconds;
        index = this.maxStacks - 1;
        this.samples[index] ??= {stack: [1], weight: 0, milliseconds: 0};
      }
    }
    this.samples[index].weight += sample.weight;
    this.samples[index].milliseconds += milliseconds;
  }

  allocation(bytes, type, kind, resize = false) {
    const frame = this.vm.top, method = this.method(frame);
    const counts = this.methods[method];
    const offset = frame?.method ? frame.lastOffset : (frame?.pc ?? 1) - 1;
    const key = method + ':' + offset;
    let site = this.sites.get(key);
    if (!site && this.sites.size < this.maxSites) {
      site = {method, offset, allocations: 0, bytes: 0};
      this.sites.set(key, site);
    }
    if (!site) this.siteOverflow += bytes;
    if (!resize) {
      this.allocations++;
      counts.allocations++;
      if (site) site.allocations++;
    }
    this.allocatedBytes += bytes;
    counts.allocatedBytes += bytes;
    if (site) site.bytes += bytes;
    this.event(RuntimeEventName.AllocationTick, {method, offset, bytes, type, kind, resize});
  }

  exception(fault) {
    this.event(RuntimeEventName.ExceptionThrown, {type: fault.name, method: this.method(this.vm.top)});
  }

  gcStart(stats) {
    this.event(RuntimeEventName.GCStart, {collection: stats.collections + 1, liveBytes: stats.liveBytes});
  }

  gcEnd(stats) {
    this.event(RuntimeEventName.GCEnd, {collection: stats.collections, liveBytes: stats.liveBytes,
      freedObjects: stats.freedThisCollection, freedBytes: stats.bytesThisCollection});
  }

  suspend(context, reason) {
    this.flushSample();
    for (const id of this.waitingContexts) {
      const state = this.vm.scheduler.contexts.get(id)?.status;
      if (!state || ['completed', 'faulted', 'canceled'].includes(state)) this.waitingContexts.delete(id);
    }
    if (this.waitingContexts.has(context)) return;
    this.waitingContexts.add(context);
    this.suspensions++;
    this.event(RuntimeEventName.Suspend, {context, reason});
  }

  resume(context) {
    this.flushSample();
    if (this.waitingContexts.delete(context)) this.event(RuntimeEventName.Resume, {context});
  }

  /** Sample flushes and subscriber delivery happen at a host-visible slice boundary. */
  boundary() {
    this.flushSample();
    const state = this.vm.state;
    if (state !== this.lastState) {
      if (state === 'paused') {
        this.suspensions++;
        this.event(RuntimeEventName.Suspend, {state});
      } else if (this.lastState === 'paused') {
        this.event(RuntimeEventName.Resume, {state});
      }
      this.lastState = state;
    }
    this.events.flush();
  }

  export() {
    this.flushSample();
    return {format: 'SharpForge.ExecutionProfile/1', clock: 'instructions',
      instructions: this.instructions, allocations: this.allocations, allocatedBytes: this.allocatedBytes,
      suspensions: this.suspensions, sampleBudget: this.sampleBudget,
      duration: {enabled: !!this.durationClock, clock: this.durationClock ? 'monotonic' : null, unit: 'milliseconds',
        totalMilliseconds: this.durationClock?.totalMilliseconds ?? 0, intervals: this.durationClock?.intervals ?? 0},
      overflow: {methods: this.methodOverflow, stackInstructions: this.stackOverflow,
        stackMilliseconds: this.stackDurationOverflow, allocationBytes: this.siteOverflow},
      methods: this.methods.map(method => ({...method})),
      samples: this.samples.map(sample => ({stack: [...sample.stack], weight: sample.weight, milliseconds: sample.milliseconds})),
      allocationSites: [...this.sites.values()].map(site => ({...site})), events: this.events.export()};
  }
}

export function createExecutionProfiler(vm, option) {
  if (option === undefined || option === false) return null;
  if (option !== true && (!option || typeof option !== 'object' || Array.isArray(option))) {
    throw new TypeError('profile must be a boolean or profiler options');
  }
  return new ExecutionProfiler(vm, option === true ? {} : option);
}
