import {VirtualMachine} from './vm.js';
import {CilVirtualMachine} from './cil-vm.js';
import {CooperativeScheduler} from './scheduler.js';
import {isReference, ManagedFault} from './heap.js';
import {verifyCilAssembly} from '@sharpforge/cil';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** A session owns one managed heap and static state; sequential calls cannot overlap, and disposal cancels all work. */
export class ManagedInvocationSession {
  constructor(artifact, options = {}) {
    this.options = options;
    this.backend = options.backend ?? 'source';
    if (!['source', 'cil'].includes(this.backend)) throw new Error('Unsupported managed invocation backend');
    if (this.backend === 'source') {
      const entry = options.entryPoint ? artifact.methods.find(method => method.qualifiedName === options.entryPoint) :
        artifact.methods[artifact.entryPoint];
      const compilerStartup = options.entryPoint === undefined && entry?.name === '<startup>' &&
        entry.parameters.length === 1 && entry.parameters[0].type === 'string[]';
      if (!entry || !entry.isStatic || entry.parameters.length && !compilerStartup) {
        throw new Error('Invocation bootstrap must be a parameterless static method');
      }
      this.vm = new VirtualMachine({...artifact, outputKind: 'exe', entryPoint: entry.id}, options);
    } else this.vm = new CilVirtualMachine(artifact, {...options, methodToken: options.entryPoint});
    this.initialized = false;
    this.busy = false;
    this.disposed = false;
    this.poisoned = false;
    this.verifiedMethods = new Set();
  }

  ensure() {
    if (this.disposed) throw new Error('Managed invocation session is disposed');
    if (this.poisoned) throw new Error('Managed invocation session ended after cancellation or a fatal runtime fault');
    if (this.busy) throw new Error('Managed invocation is already active');
  }

  async initialize(options = {}) {
    this.ensure();
    if (this.initialized) return;
    this.busy = true;
    try {
      const result = await this.execute(options);
      if (result.fault) throw result.fault;
      this.initialized = true;
    } finally { this.busy = false; }
  }

  method(name) {
    if (typeof name !== 'string' && !Number.isInteger(name)) throw new Error('Invalid managed method identifier');
    if (this.backend === 'cil') {
      const methods = [...this.vm.inspector.methods.values()];
      const matches = methods.filter(method => method.token === name || method.name === name ||
        method.owner + '.' + method.name === name || method.owner + '::' + method.name === name);
      if (matches.length !== 1) throw new Error('Managed method is missing or ambiguous: ' + name);
      return this.vm.inspector.getMethod(matches[0].token);
    }
    const matches = this.vm.image.methods.filter(method => method.id === name || method.qualifiedName === name || method.name === name);
    if (matches.length !== 1) throw new Error('Managed method is missing or ambiguous: ' + name);
    return matches[0];
  }

  marshal(value, type) {
    if (this.backend === 'cil') return this.vm.marshal(value, type);
    if (type.endsWith('[]')) {
      if (!Array.isArray(value)) throw new Error('Expected an array argument');
      const reference = this.vm.heap.array(type.slice(0, -2), value.length);
      return this.vm.heap.withRoots([reference], () => {
        const data = this.vm.heap.get(reference).data;
        for (let index = 0; index < value.length; index++) data[index] = this.marshal(value[index], type.slice(0, -2));
        return reference;
      });
    }
    if (type === 'string') {
      if (value === null) return null;
      if (typeof value !== 'string') throw new Error('Expected a string argument');
      return this.vm.heap.string(value);
    }
    if (type === 'bool' && typeof value === 'boolean') return value;
    if (['int', 'double', 'float', 'long', 'uint', 'short', 'byte'].includes(type) &&
      (typeof value === 'number' && Number.isFinite(value) || typeof value === 'bigint')) return value;
    if (value === null) return null;
    throw new Error('Unsupported host argument type: ' + type);
  }

  value(reference, depth = 0) {
    if (depth > 32) throw new Error('Managed result nesting limit exceeded');
    if (!isReference(reference)) return this.vm.value(reference);
    const record = this.vm.heap.get(reference);
    if (record.kind === 'array') return record.data.map(value => this.value(value, depth + 1));
    if (record.kind === 'box') return this.value(record.data[0], depth + 1);
    if (record.kind === 'string') return record.data;
    if (record.kind === 'task') {
      const task = this.vm.scheduler.taskRecord(reference);
      if (!terminal.has(task.status)) throw new ManagedFault('InvalidOperationException', 'Managed task has not completed');
      if (task.status !== 'completed') throw this.vm.scheduler.failure(task);
      return this.value(task.result, depth + 1);
    }
    throw new ManagedFault('NotSupportedException', 'Host result conversion does not support ' + record.type);
  }

  async execute(options) {
    const outputStart = this.vm.output.length;
    const started = performance.now();
    let lastPoint = null;
    this.vm.onException = () => {
      for (const frame of [...this.vm.frames].reverse()) {
        const point = frame.point ?? frame.method?.instructions.slice(0, frame.pc).findLast(instruction => instruction.point)?.point;
        if (point && !point.uri?.startsWith('sharpforge://')) { lastPoint = point; break; }
      }
      return false;
    };
    let result;
    try {
      result = await this.vm.runAsync({signal: options.signal, onSlice: vm => {
        lastPoint ??= vm.currentPoint ?? vm.top?.point ?? null;
        options.onSlice?.(vm);
      }});
    } catch (error) {
      this.poisoned = true;
      throw error;
    } finally { this.vm.onException = null; }
    if (!['terminated', 'faulted'].includes(result.state)) {
      throw new ManagedFault('NotSupportedException', 'Managed invocation is waiting for an unavailable host continuation');
    }
    let fault = result.fault;
    let value = null;
    if (!fault) {
      try { value = this.value(this.vm.returnValue); }
      catch (error) { fault = error; }
    }
    if (fault && this.vm.frames.length) this.poisoned = true;
    return {state: fault ? 'faulted' : result.state, fault, value, stdout: this.vm.output.slice(outputStart).join(''),
      durationMs: performance.now() - started, statistics: this.vm.statistics(), source: lastPoint};
  }

  /** Invoke a static method after the preceding call is quiescent, retaining only the session's managed heap/static state. */
  async invoke(name, options = {}) {
    this.ensure();
    if (!this.initialized) await this.initialize(options);
    const method = this.method(name);
    const signature = this.backend === 'cil' ? method.signature : method;
    if (!signature.isStatic) throw new Error('Host invocation requires a static method');
    const args = options.arguments ?? [];
    if (args.length !== signature.parameters.length) throw new Error('Managed argument count mismatch');
    if (this.backend === 'cil' && !this.verifiedMethods.has(method.token)) {
      const report = verifyCilAssembly(this.vm.inspector, {methodToken: method.token, arguments: args});
      if (!report.success) throw new ManagedFault('NotSupportedException', report.issues.map(issue => issue.message).join('; '));
      this.vm.report = {...this.vm.report, methods: [...new Set([...this.vm.report.methods, ...report.methods])],
        stackHeights: {...this.vm.report.stackHeights, ...report.stackHeights}};
      this.verifiedMethods.add(method.token);
    }
    const previous = this.vm.scheduler;
    if ([...previous.tasks.values()].some(task => !terminal.has(task.status))) throw new Error('Previous invocation has unfinished managed tasks');
    const scheduler = new CooperativeScheduler(this.vm, this.options);
    scheduler.nextTaskId = previous.nextTaskId;
    scheduler.clock = previous.now();
    scheduler.epoch = performance.now() - scheduler.clock;
    this.vm.scheduler = scheduler;
    this.vm.fault = null;
    this.vm.pendingFault = null;
    this.vm.returnValue = null;
    this.vm.exitCode = 0;
    this.vm.instructions = 0;
    this.vm.state = 'ready';
    const values = [];
    this.vm.heap.withRoots(values, () => {
      for (let index = 0; index < args.length; index++) {
        values.push(this.marshal(args[index], this.backend === 'cil' ? signature.parameters[index] : signature.parameters[index].type));
      }
      this.vm.call(this.backend === 'cil' ? method.token : method.id, values);
    });
    if (this.backend === 'cil') {
      this.vm.returnType = signature.returnType;
      this.vm.ensureInitialized(method.ownerToken, 'static-method');
    }
    this.busy = true;
    try { return await this.execute(options); }
    finally { this.busy = false; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.vm.stop();
  }
}
