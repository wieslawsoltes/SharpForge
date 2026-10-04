import {
  isSynchronizationIntrinsic
} from '@sharpforge/cil';
import {
  ManagedFault,
  isReference
} from '../heap.js';
import {
  SUSPENDED
} from '../platform.js';
import {
  copyExecution
} from './execution-copy.js';
import {
  number,
  storage,
  compare
} from './numeric-ops.js';
import {
  numericTypeName
} from '@sharpforge/bytecode';
import {
  scalarBinary
} from './scalar-ops.js';
import {
  singleToInt32Bits,
  doubleToInt64Bits
} from '@sharpforge/bytecode';
import {
  validatePointer,
  pointerType
} from './control-pointers.js';
import {
  castReference
} from './casting.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);
const fail = (name, message) => {
  throw new ManagedFault(name, message);
};
const key = reference => reference.h + ':' + reference.g;
const aliases = Object.freeze({'System.Object': 'object', 'System.String': 'string', 'System.Boolean': 'bool'});
const canonical = type => aliases[type] ?? numericTypeName(type);
const scalar = value => value?.enumType ? value.value : number(value);

/** Monitor ownership belongs to logical scheduler contexts. Atomic APIs run
 * wholly inside one VM instruction; no host threads or promises are created. */
export class SyncPrimitives {
  constructor(vm) {
    this.vm = vm;
    this.blocks = new Map();
    this.fenceRevision = 0;
    this.contentions = 0n;
  }
  get scheduler() {
    return this.vm.scheduler;
  }
  boolean(value) {
    return this.vm.inspector ? value ? 1 : 0 : !!value;
  }
  barrier() {
    this.fenceRevision++;
  }
  block(reference, create = true) {
    if (reference === null) fail('ArgumentNullException', 'Synchronization object cannot be null');
    if (!isReference(reference)) fail('ArgumentException', 'Synchronization requires a managed object reference');
    this.vm.heap.get(reference);
    const id = key(reference);
    let block = this.blocks.get(id);
    if (!block && create) {
      block = {
        reference,
        owner: null,
        depth: 0,
        abandoned: false,
        entries: [],
        conditions: []
      };
      this.blocks.set(id, block);
    }
    return block;
  }
  context() {
    this.scheduler.ensure();
    return this.scheduler.currentId;
  }
  owned(reference) {
    const block = this.block(reference, false);
    if (!block || block.owner !== this.context()) fail('SynchronizationLockException',
      'Object synchronization method was called from an unsynchronized block of code');
    return block;
  }
  timeout(value) {
    const timeout = Number(scalar(value));
    if (!Number.isInteger(timeout) || timeout < -1 || timeout > 2147483647) fail('ArgumentOutOfRangeException',
      'Timeout must be -1 or an Int32 number of milliseconds');
    return timeout;
  }
  lockFlag(pointer) {
    validatePointer(this.vm, pointer, {
      write: true
    });
    if (pointerType(this.vm, pointer) !== this.vm.heap.methodTables.get('bool')) {
      fail('InvalidProgramException', 'lockTaken must address a Boolean');
    }
    if (scalar(this.vm.dereference(pointer))) fail('ArgumentException', 'lockTaken must initially be false');
  }
  setFlag(pointer, value) {
    if (pointer) this.vm.dereference(pointer, true, this.boolean(value));
  }
  acquire(block, id, depth = 1, flag = null) {
    block.owner = id;
    block.depth = depth;
    block.abandoned = false;
    this.setFlag(flag, true);
    this.barrier();
  }
  prune(block) {
    if (block.owner === null && !block.entries.length && !block.conditions.length) this.blocks.delete(key(block.reference));
  }
  queued(block, entry, condition = false) {
    if (this.scheduler.suppressed) fail('InvalidOperationException', 'A contended monitor cannot block during synchronous function evaluation');
    const task = this.scheduler.createTask(entry.resultType),
      item = {
        ...entry,
        contextId: this.context(),
        task: task.ref,
        deadline: entry.timeout < 0 ? null : this.scheduler.now() + entry.timeout
      };
    (condition ? block.conditions : block.entries).push(item);
    try {
      return {
        item,
        suspended: this.scheduler.wait(task.ref, {
          pushResult: !this.vm.inspector || entry.resultType !== 'void',
          voidResult: entry.resultType === 'void'
        })
      };
    } catch (error) {
      const queue = condition ? block.conditions : block.entries;
      queue.splice(queue.indexOf(item), 1);
      this.scheduler.complete(task, null, error);
      throw error;
    }
  }
  grant(block) {
    while (block.owner === null && block.entries.length) {
      const item = block.entries.shift(),
        context = this.scheduler.contexts.get(item.contextId);
      if (!context || terminal.has(context.status)) {
        this.scheduler.complete(this.scheduler.taskRecord(item.task), null, null, true);
        continue;
      }
      try {
        this.acquire(block, item.contextId, item.depth, item.flag);
        this.scheduler.complete(this.scheduler.taskRecord(item.task), item.resultType === 'bool' ? this.boolean(item.result) : null);
      } catch (error) {
        block.owner = null;
        block.depth = 0;
        this.scheduler.complete(this.scheduler.taskRecord(item.task), null, error);
      }
    }
    this.prune(block);
  }
  enter(reference, {
    timeout = -1,
    flag = null,
    tryEnter = false
  } = {}) {
    timeout = this.timeout(timeout);
    if (flag) this.lockFlag(flag);
    const block = this.block(reference),
      id = this.context();
    if (block.owner === null) {
      this.acquire(block, id, 1, flag);
      return tryEnter && !flag ? this.boolean(true) : null;
    }
    if (block.owner === id) {
      if (block.depth === 2147483647) fail('OverflowException', 'Monitor recursion limit exceeded');
      block.depth++;
      this.setFlag(flag, true);
      return tryEnter && !flag ? this.boolean(true) : null;
    }
    if (timeout === 0) return tryEnter && !flag ? this.boolean(false) : null;
    this.contentions++;
    return this.queued(block, {
      kind: 'enter',
      timeout,
      depth: 1,
      flag,
      result: true,
      resultType: tryEnter && !flag ? 'bool' : 'void'
    }).suspended;
  }
  exit(reference) {
    const block = this.owned(reference);
    this.barrier();
    if (--block.depth === 0) {
      block.owner = null;
      this.grant(block);
    }
    return null;
  }
  wait(reference, timeout = -1) {
    timeout = this.timeout(timeout);
    const block = this.owned(reference);
    // Allocate and park before releasing ownership: a task-budget failure must
    // not lose a lock, and the waiting task must exist before another can pulse.
    const waiting = this.queued(block, {
      kind: 'wait',
      timeout,
      depth: block.depth,
      flag: null,
      result: true,
      resultType: 'bool'
    }, true);
    block.owner = null;
    block.depth = 0;
    this.barrier();
    this.grant(block);
    this.poll();
    return waiting.suspended;
  }
  pulse(reference, all = false) {
    const block = this.owned(reference),
      count = all ? block.conditions.length : Math.min(1, block.conditions.length);
    for (let i = 0; i < count; i++) {
      const item = block.conditions.shift();
      item.deadline = null;
      block.entries.push(item);
    }
    return null;
  }
  poll() {
    const now = this.scheduler.now();
    for (const block of this.blocks.values()) {
      for (const item of [...block.conditions])
        if (item.deadline !== null && item.deadline <= now) {
          block.conditions.splice(block.conditions.indexOf(item), 1);
          item.deadline = null;
          item.result = false;
          block.entries.push(item);
        }
      for (const item of [...block.entries])
        if (item.kind === 'enter' && item.deadline !== null && item.deadline <= now) {
          block.entries.splice(block.entries.indexOf(item), 1);
          this.scheduler.complete(this.scheduler.taskRecord(item.task), item.resultType === 'bool' ? this.boolean(false) : null);
        }
      this.grant(block);
    }
  }
  nextDelay() {
    let deadline = Infinity;
    for (const block of this.blocks.values())
      for (const item of [...block.entries, ...block.conditions])
        if (item.deadline !== null) deadline = Math.min(deadline, item.deadline);
    return deadline === Infinity ? null : Math.max(0, deadline - this.scheduler.now());
  }
  cancelContext(id) {
    for (const block of this.blocks.values()) {
      for (const queue of [block.entries, block.conditions])
        for (const item of [...queue])
          if (item.contextId === id) {
            queue.splice(queue.indexOf(item), 1);
            this.scheduler.complete(this.scheduler.taskRecord(item.task), null, null, true);
          }
      // A context ending while holding a monitor does not transfer ownership.
      // Keep that cause visible in deadlock reports until VM cancellation/unload.
      if (block.owner === id) block.abandoned = true;
      this.prune(block);
    }
  }
  clear() {
      this.blocks.clear();
      this.fenceRevision = 0;
      this.contentions = 0n;
    }
    * roots() {
      for (const block of this.blocks.values()) {
        yield block.reference;
        for (const item of [...block.entries, ...block.conditions]) {
          yield item.task;
          if (item.flag?.owner) yield item.flag.owner;
        }
      }
    }
  snapshot(memo = new Map()) {
    return copyExecution({
      blocks: [...this.blocks],
      fenceRevision: this.fenceRevision,
      contentions: this.contentions
    }, memo);
  }
  restore(snapshot, memo = new Map()) {
    if (!snapshot) {
      this.clear();
      return;
    }
    const state = copyExecution(snapshot, memo);
    this.blocks = new Map(state.blocks);
    this.fenceRevision = state.fenceRevision;
    this.contentions = state.contentions;
  }
  /** Reporting only: a cooperative deadlock is not a CLR managed exception. */
  deadlocks() {
    const edges = new Map(),
      waiting = [],
      abandoned = [];
    for (const block of this.blocks.values()) {
      if (block.abandoned) abandoned.push({
        reference: block.reference,
        owner: block.owner,
        waiters: block.entries.map(item => item.contextId)
      });
      for (const item of block.entries) {
        waiting.push({
          contextId: item.contextId,
          kind: item.kind,
          reference: block.reference,
          owner: block.owner,
          deadline: item.deadline
        });
        if (block.owner !== null && item.deadline === null) edges.set(item.contextId, {
          to: block.owner,
          reference: block.reference,
          kind: 'monitor'
        });
      }
      for (const item of block.conditions) waiting.push({
        contextId: item.contextId,
        kind: 'condition',
        reference: block.reference,
        owner: null,
        deadline: item.deadline
      });
    }
    for (const context of this.scheduler.contexts.values())
      if (context.wait?.task && !edges.has(context.id)) {
        const task = this.scheduler.taskRecord(context.wait.task);
        if (task.contextId && !terminal.has(task.status)) edges.set(context.id, {
          to: task.contextId,
          reference: context.wait.task,
          kind: 'task'
        });
      }
    const cycles = [],
      reported = new Set();
    for (const start of edges.keys()) {
      const path = [],
        positions = new Map();
      let id = start;
      while (edges.has(id) && !positions.has(id)) {
        positions.set(id, path.length);
        path.push(id);
        id = edges.get(id).to;
      }
      if (!positions.has(id)) continue;
      const contexts = path.slice(positions.get(id)),
        identity = [...contexts].sort((a, b) => a - b).join(',');
      if (reported.has(identity)) continue;
      reported.add(identity);
      cycles.push({
        contextIds: contexts,
        edges: contexts.map(contextId => ({
          contextId,
          ...edges.get(contextId)
        }))
      });
    }
    return {
      cycles,
      abandoned,
      waiting
    };
  }
  atomic(descriptor, args) {
    const signature = descriptor.signature ?? descriptor,
      name = descriptor.name,
      owner = descriptor.owner;
    if (['MemoryBarrier', 'ReadBarrier', 'WriteBarrier'].includes(name)) {
      this.barrier();
      return null;
    }
    const pointer = args[0],
      writing = owner !== 'System.Threading.Volatile' ? name !== 'Read' : name === 'Write';
    validatePointer(this.vm, pointer, {
      write: writing
    });
    const table = pointerType(this.vm, pointer),
      type = canonical(table.name),
      declared = canonical(signature.parameters[0].slice(0, -1));
    if (declared !== '!!0' && declared !== type) fail('InvalidProgramException', 'Atomic operation does not match its managed location type');
    const generic = (descriptor.methodArguments ?? descriptor.genericArguments)?.length === 1 || (signature.genericArity ?? 0) === 1;
    if (generic && owner === 'System.Threading.Volatile' && table.flags.valueType) fail('NotSupportedException',
      'Generic Volatile requires a reference type');
    if (generic && owner === 'System.Threading.Interlocked' && table.flags.valueType && !table.flags.primitive && !table.flags.enum) fail(
      'NotSupportedException', 'Generic Interlocked requires a primitive, enum or reference type');
    const value = this.vm.dereference(pointer),
      context = {
        ...this.vm.options,
        fault: (name, message) => new ManagedFault(name, message)
      };
    const element = table.flags.enum ? canonical(table.enumUnderlyingType?.name ?? 'int') : type;
    const normalized = input => table.flags.valueType ? storage(scalar(input), element, context) : input;
    const equal = (left, right) => {
      if (!table.flags.valueType) return left === right || isReference(left) && isReference(right) && left.h === right.h && left.g === right.g &&
        (left.heapOwner === undefined || right.heapOwner === undefined || left.heapOwner === right.heapOwner);
      if (element === 'float') return singleToInt32Bits(left) === singleToInt32Bits(right);
      if (element === 'double') return doubleToInt64Bits(left) === doubleToInt64Bits(right);
      if (element === 'bool') return !!scalar(left) === !!scalar(right);
      return compare(normalized(left), normalized(right), 'eq');
    };
    this.barrier();
    if (name === 'Read') return type === 'bool' ? this.boolean(scalar(value)) : value;
    if (!table.flags.valueType) {
      castReference(this.vm.heap, args[1], table);
      if (name === 'CompareExchange') castReference(this.vm.heap, args[2], table);
    }
    let replacement = args[1],
      result = value;
    if (name === 'Write' || name === 'Exchange') {} else if (name === 'CompareExchange') {
      if (!equal(value, args[2])) return type === 'bool' ? this.boolean(scalar(value)) : value;
    } else {
      const operation = {
        Increment: '+',
        Decrement: '-',
        Add: '+',
        And: '&',
        Or: '|'
      } [name];
      if (!operation) fail('MissingMethodException', 'Unsupported atomic operation');
      const operand = name === 'Increment' || name === 'Decrement' ? (type === 'long' || type === 'ulong' ? 1n : 1) : args[1];
      replacement = scalarBinary(operation, value, operand, type, false, context);
      if (['Increment', 'Decrement', 'Add'].includes(name)) result = replacement;
    }
    this.vm.dereference(pointer, true, replacement);
    this.barrier();
    return name === 'Write' ? null : type === 'bool' ? this.boolean(scalar(result)) : result;
  }
  invoke(descriptor, args) {
    if (!isSynchronizationIntrinsic(descriptor)) return {
      handled: false
    };
    const signature = descriptor.signature ?? descriptor,
      name = descriptor.name;
    if (descriptor.owner !== 'System.Threading.Monitor') return {
      handled: true,
      value: this.atomic(descriptor, args)
    };
    let value;
    if (name === 'get_LockContentionCount') value = this.contentions;
    else if (name === 'Enter') value = this.enter(args[0], {
      flag: signature.parameters.length === 2 ? args[1] : null
    });
    else if (name === 'TryEnter') {
      const last = signature.parameters.at(-1),
        hasTimeout = canonical(signature.parameters[1]) === 'int',
        flag = last?.endsWith('&') && canonical(last.slice(0, -1)) === 'bool' ? args.at(-1) : null;
      value = this.enter(args[0], {
        timeout: hasTimeout ? args[1] : 0,
        flag,
        tryEnter: true
      });
    } else if (name === 'Exit') value = this.exit(args[0]);
    else if (name === 'Wait') value = this.wait(args[0], args[1] ?? -1);
    else if (name === 'Pulse' || name === 'PulseAll') value = this.pulse(args[0], name === 'PulseAll');
    else if (name === 'IsEntered') value = this.boolean(this.block(args[0], false)?.owner === this.context());
    else fail('MissingMethodException', 'Unknown monitor operation');
    return {
      handled: true,
      value
    };
  }
}

export function invokeSynchronization(vm, descriptor, args) {
  if (!isSynchronizationIntrinsic(descriptor)) return {
    handled: false
  };
  vm.sync ??= new SyncPrimitives(vm);
  return vm.sync.invoke(descriptor, args);
}

export {
  validateSynchronizationSnapshot
}
from './sync-snapshot-validation.js';
