import {cloneWorkspaceState, hashWorkspaceState, diffWorkspaceStates, workspaceStateSize} from './transaction-state.js';

/** Byte-bounded browser/directory-handle undo and redo; rejects newer edits before applying any inverse operation. */
export class FileOperationHistory {
  constructor(journal, {maxBytes = 32 * 1024 * 1024, maxEntries = 32} = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError('Invalid history capacity');
    }
    Object.assign(this, {journal, maxBytes, maxEntries});
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.busy = false;
  }

  get length() { return this.undoStack.length; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  async execute(operations, options = {}) {
    if (this.busy) throw new Error('SFW1120: History operation is in progress');
    this.busy = true;
    try {
      const receipt = await this.journal.execute(operations, options);
      this.push(receipt);
      return receipt;
    } catch (error) {
      if (error.committed && error.receipt) this.push(error.receipt);
      throw error;
    } finally { this.busy = false; }
  }

  push(receipt) {
    const before = cloneWorkspaceState(receipt.before);
    const after = cloneWorkspaceState(receipt.after);
    const size = workspaceStateSize(before) + workspaceStateSize(after);
    this.redoStack = [];
    this.undoStack.push({before, after, size, label: receipt.label});
    this.trim();
  }

  trim() {
    this.bytes = [...this.undoStack, ...this.redoStack].reduce((total, entry) => total + entry.size, 0);
    while (this.undoStack.length + this.redoStack.length > this.maxEntries || this.bytes > this.maxBytes) {
      const removed = this.undoStack.length ? this.undoStack.shift() : this.redoStack.shift();
      if (!removed) break;
      this.bytes -= removed.size;
    }
  }

  async restore(redo, options) {
    if (this.busy) throw new Error('SFW1120: History operation is in progress');
    const source = redo ? this.redoStack : this.undoStack;
    const destination = redo ? this.undoStack : this.redoStack;
    const entry = source.at(-1);
    if (!entry) throw new Error('SFW1121: No file operation to ' + (redo ? 'redo' : 'undo'));
    this.busy = true;
    try {
      const current = this.journal.getState();
      const expected = redo ? entry.before : entry.after;
      const target = redo ? entry.after : entry.before;
      if (await hashWorkspaceState(current, options) !== await hashWorkspaceState(expected, options)) {
        throw new Error('SFW1122: Workspace has newer edits; undo/redo would overwrite them');
      }
      const operations = await diffWorkspaceStates(current, target, options);
      try {
        const receipt = await this.journal.execute(operations,
          {...options, targetState: target, label: (redo ? 'Redo ' : 'Undo ') + entry.label});
        source.pop();
        destination.push(entry);
        return receipt;
      } catch (error) {
        if (error.committed) {
          source.pop();
          destination.push(entry);
        }
        throw error;
      }
    } finally { this.busy = false; }
  }

  undo(options = {}) { return this.restore(false, options); }
  redo(options = {}) { return this.restore(true, options); }
  clear() { this.undoStack = []; this.redoStack = []; this.bytes = 0; }
}
