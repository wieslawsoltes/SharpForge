import {DebuggerMemoryScope} from '@sharpforge/runtime';

/** Shared byte-memory inspection for source/reloaded/CIL sessions; all views belong to a debugger stop. */
export class MemoryDebugSession {
  constructor(options = {}) {
    const maxReferences = options.maxMemoryReferences ?? 128;
    const maxTransferBytes = options.maxMemoryTransferBytes ?? 65536;
    if (!Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096 ||
        !Number.isSafeInteger(maxTransferBytes) || maxTransferBytes < 1 || maxTransferBytes > 1024 * 1024) {
      throw new RangeError('Invalid debugger memory budgets');
    }
    this.debuggerMemoryOptions = {maxReferences, maxTransferBytes};
    this.debuggerMemory = null;
  }

  get memoryTransferLimit() { return this.debuggerMemoryOptions.maxTransferBytes; }

  memoryScope() {
    if (this.vm.state !== 'paused') throw new Error('Pause execution before inspecting or editing managed memory');
    if (!this.debuggerMemory) {
      this.debuggerMemory = new DebuggerMemoryScope(this.vm.heap, this.debuggerMemoryOptions);
      this.vm.gcRuntime.debuggerScopes.add(this.debuggerMemory);
      this.vm.gcRuntime.debuggerSessions.add(this);
    }
    return this.debuggerMemory;
  }

  memoryReference(value, options) {
    const scope = this.memoryScope();
    return scope.supports(value) ? scope.open(value, options).memoryReference : null;
  }

  pinMemory(value, options) { return this.memoryScope().open(value, options); }
  readMemory(memoryReference, options) { return this.memoryScope().read(memoryReference, options); }

  writeMemory(memoryReference, bytes, options) {
    const scope = this.memoryScope();
    const request = scope.validateWrite(memoryReference, bytes, options);
    if (request.length) this.remember(true);
    const revision = this.vm.heap.mutationRevision;
    try { return request.execute(); }
    finally {
      if (this.vm.heap.mutationRevision !== revision) {
        this.vm.writeRevision++;
        this.rememberStop();
      }
    }
  }

  releaseMemory(memoryReference) { return this.memoryScope().release(memoryReference); }

  collect() {
    if (this.vm.state === 'running') {
      throw new Error('Pause ' + (this.vm.inspector ? 'execution ' : '') + 'before collecting through the debugger');
    }
    this.remember(true);
    return this.vm.heap.collect();
  }
}
