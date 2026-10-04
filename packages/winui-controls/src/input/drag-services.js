import { validateDragData, validateDropToken, dragOperation } from './drag-data.js';
import { dragVisualState } from './drag-visual.js';
import { validateStorageDescriptors } from './drop-files.js';

class DragDeferral {
  constructor(service, payload, state) { Object.assign(this, { service, payload, state, completed: false }); }
  Complete() {
    if (this.completed) throw new Error('SFUI1668: Drag deferral has already completed');
    this.completed = true;
    if (--this.state.pending === 0 && this.state.finished) this.service.completeEvent(this.payload.DragEvent, this.payload);
  }
  snapshot() { return { completed: this.completed }; }
  restore(value) { this.completed = value.completed; }
}

/** Shared language service: asynchronous replies update the root's private drag state, never base properties. */
export class DragServices {
  constructor(context, { send, readFiles } = {}) {
    Object.assign(this, { context, send, readFiles });
    this.deferrals = new WeakMap();
  }
  prepare(owner, data, options = {}) {
    this.sendCommand({ op: 'dragData', id: this.context.id(owner), data: data == null ? null : validateDragData(data.snapshot?.() ?? data),
      allowedOperations: dragOperation(options.allowedOperations ?? 7), cancel: !!options.cancel });
  }
  getDeferral(payload) {
    if (!payload?.DragSession || !payload.DragEvent) throw new Error('SFUI1668: No active drag event');
    let state = this.deferrals.get(payload);
    if (!state) { state = { pending: 0, finished: false }; this.deferrals.set(payload, state); }
    if (state.pending >= 64) throw new RangeError('SFUI1668: Drag deferral limit');
    state.pending++;
    return new DragDeferral(this, payload, state);
  }
  completeEvent(event, payload) {
    if (!payload?.DragSession || !['DragStarting', 'DragEnter', 'DragOver', 'DragLeave', 'Drop'].includes(event)) return;
    const deferrals = this.deferrals.get(payload);
    if (deferrals?.pending) { deferrals.finished = true; return; }
    const source = payload.OriginalSource ?? payload.Source;
    const id = typeof source === 'string' ? source : this.context.id(source);
    const command = { op: 'dragResponse', id, session: payload.DragSession, event };
    if (event === 'DragStarting') Object.assign(command, { data: validateDragData(payload.Data),
      allowedOperations: dragOperation(payload.AllowedOperations), cancel: !!payload.Cancel, dragUI: dragVisualState(payload.DragUI) });
    else Object.assign(command, { acceptedOperation: dragOperation(payload.AcceptedOperation ?? 0),
      dragUI: dragVisualState(payload.DragUIOverride) });
    this.sendCommand(command);
  }
  async storageItems(data, options) {
    const token = validateDropToken(data?.StorageToken);
    if (!this.readFiles) throw new Error('SFUI1667: The application has no file-drop capability');
    return validateStorageDescriptors(await this.readFiles(token, options));
  }
  sendCommand(command) {
    if (!this.send) throw new Error('SFUI1668: Drag service has no host command transport');
    this.send(command);
  }
  snapshot() { return {}; }
  restore() { this.deferrals = new WeakMap(); }
}
