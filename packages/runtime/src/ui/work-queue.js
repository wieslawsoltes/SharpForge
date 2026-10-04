import {ManagedFault} from '../heap.js';
import {wakeManagedUIWork, resumeManagedUIWork} from './work-scheduling.js';

/** Native UI continuations share the VM pause boundary and explicitly retain their managed inputs. */
export class ManagedUIWorkQueue {
  constructor(context) {
    this.context = context;
    this.pending = new Map();
    this.nextId = -1;
    this.scheduled = false;
    this.draining = false;
    this.closed = false;
    this.uiDepth = 0;
  }

  enqueue(action, roots = []) {
    if (this.closed) throw new ManagedFault('ObjectDisposedException', 'The UI dispatcher is closed');
    if (this.pending.size >= (this.context.services.maxPendingUIWork ?? 100000)) {
      throw new ManagedFault('ExecutionLimitException', 'UI work queue limit exceeded');
    }
    const id = this.nextId--;
    this.pending.set(id, {action, roots: [...roots]});
    this.context.journal?.contexts.add(id);
    wakeManagedUIWork(this.context.platform.vm);
    this.requestDrain();
    return id;
  }

  requestDrain() {
    if (this.scheduled || this.closed || !this.pending.size) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.closed) return;
      if (this.context.platform.options.onUIWork) this.context.platform.options.onUIWork();
      else this.drain();
    });
  }

  enterThread(action) {
    this.uiDepth++;
    try { return action(); } finally { this.uiDepth--; }
  }

  currentThread() {
    const scheduler = this.context.platform.vm.scheduler;
    return this.uiDepth || scheduler?.currentId === 1 || scheduler?.current?.kind === 'ui'
      || scheduler?.current?.dispatcherThread === 'ui' ? 'ui' : scheduler?.currentId;
  }

  drain() {
    const vm = this.context.platform.vm;
    if (this.closed || this.draining || vm.state === 'paused' || vm.state === 'faulted' || vm.scheduler?.suppressed) return 0;
    this.draining = true;
    let count = 0;
    try {
      this.enterThread(() => {
        for (const [id, entry] of this.pending) {
          if (++count > 256) break;
          this.pending.delete(id);
          vm.heap.withRoots(entry.roots, entry.action);
        }
      });
    } finally { this.draining = false; resumeManagedUIWork(vm, this.pending.size > 0); this.requestDrain(); }
    return Math.min(count, 256);
  }

  *retainedValues() { for (const entry of this.pending.values()) yield* entry.roots; }
  snapshot() { return {pending: [...this.pending], nextId: this.nextId, closed: this.closed}; }
  restore(snapshot) {
    this.pending = new Map(snapshot.pending);
    this.nextId = Math.min(this.nextId, snapshot.nextId);
    this.closed = snapshot.closed;
    this.scheduled = false;
    this.draining = false;
  }
  dispose() { this.closed = true; this.pending.clear(); }
}

export function initializeManagedDispatcher(context) {
  context.work = context.state(null, 'uiWork', () => new ManagedUIWorkQueue(context));
  context.scheduleUI = (action, roots = []) => context.work.enqueue(action, roots);
  context.dispatcherServices = {
    schedule: action => context.work.enqueue(action), uiThread: 'ui',
    currentThread: () => context.work.currentThread(), enterThread: action => context.work.enterThread(action)
  };
}
