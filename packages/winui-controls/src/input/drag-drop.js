import { readDragData, writeDragData, validateDragData, dragOperation, effectAllowed,
  operationFromEffect, preferredOperation } from './drag-data.js';
import { DropFileBroker } from './drop-files.js';
import { DragVisual, dragVisualState } from './drag-visual.js';

export { readDragData } from './drag-data.js';
const names = Object.freeze({ dragenter: 'DragEnter', dragover: 'DragOver', dragleave: 'DragLeave', drop: 'Drop' });
const emptyData = () => ({ version: 1, values: [], requestedOperation: 0 });
const positionValue = point => ({ X: point.X ?? point.x, Y: point.Y ?? point.y });

/** One host owns the native drag session and its asynchronous managed replies. */
export class DragDropManager {
  constructor({ emit = () => {}, resolve = () => null, parentOf = () => null, containsTarget = () => false,
    dataPolicy = {}, root, now = () => Date.now(), bitmapElement } = {}) {
    Object.assign(this, { emit, resolve, parentOf, containsTarget, dataPolicy, now });
    this.files = new DropFileBroker(dataPolicy);
    this.visual = new DragVisual({ root, bitmapElement });
    this.sessions = new Map();
    this.prepared = new Map();
    this.nextSession = 0;
    this.current = null;
    this.source = null;
    this.target = null;
  }
  session(source = null) {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(id);
    while (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value);
    const session = { id: 'drag-' + ++this.nextSession, source, target: null, accepted: 0, allowed: 7, data: emptyData(),
      cancel: false, expires: this.now() + 60000, position: { X: 0, Y: 0 }, ui: dragVisualState() };
    this.sessions.set(session.id, session);
    this.current = session;
    return session;
  }
  prepare(id, data, { allowedOperations = 7, cancel = false } = {}) {
    if (!this.resolve(id)) throw new Error('SFUI1666: Unknown drag source');
    if (this.prepared.size >= 20000 && !this.prepared.has(id)) throw new RangeError('SFUI1666: Drag source limit');
    this.prepared.set(id, { data: validateDragData(data), allowed: dragOperation(allowedOperations), cancel: !!cancel });
  }
  dropTarget(id) {
    const seen = new Set();
    while (id != null && !seen.has(id)) {
      if (seen.size >= 512) throw new RangeError('SFUI1666: Drag ancestry limit');
      seen.add(id);
      const p = this.resolve(id)?.properties;
      if (!p || p.IsEnabled === false || p.IsHitTestVisible === false || p.Visibility === 1 || p.Visibility === 'Collapsed') return null;
      if (p.AllowDrop) return id;
      id = this.parentOf(id);
    }
    return null;
  }
  dragSource(id) {
    const seen = new Set();
    while (id != null && !seen.has(id)) {
      if (seen.size >= 512) throw new RangeError('SFUI1666: Drag ancestry limit');
      seen.add(id);
      const properties = this.resolve(id)?.properties;
      if (!properties || properties.IsEnabled === false || properties.IsHitTestVisible === false
        || properties.Visibility === 1 || properties.Visibility === 'Collapsed') return null;
      if (properties.CanDrag || properties.CanDragItems) return id;
      id = this.parentOf(id);
    }
    return null;
  }
  handle(type, id, event, position) {
    if (type === 'dragstart') return this.start(id, event, position);
    if (type === 'dragend') return this.end(event);
    if (!names[type]) return;
    const target = this.dropTarget(id);
    if (!target) return;
    if (type === 'dragleave' && this.containsTarget(target, event.relatedTarget)) return;
    const session = this.current ?? this.session();
    if (session.cancel) { event.preventDefault(); return; }
    session.target = target; this.target = target;
    session.position = positionValue(position);
    const sourceData = session.source && session.data.values.length ? validateDragData(session.data) : null;
    const data = sourceData ?? readDragData(event.dataTransfer, { ...this.dataPolicy, files: this.files, captureFiles: type === 'drop' });
    const allowed = session.source ? session.allowed : operationFromEffect(event.dataTransfer?.effectAllowed ?? 'all');
    const args = { DragSession: session.id, DragEvent: names[type], DragSource: session.source, DataView: data, AcceptedOperation: session.accepted,
      AllowedOperations: allowed, Position: session.position, DragUIOverride: dragVisualState(session.ui),
      Modifiers: (event.shiftKey ? 4 : 0) | (event.ctrlKey ? 8 : 0) | (event.altKey ? 32 : 0) | (event.buttons & 1 ? 1 : 0), Handled: false };
    this.emit(target, names[type], args);
    session.accepted = preferredOperation(dragOperation(args.AcceptedOperation) & allowed, event);
    session.ui = dragVisualState(args.DragUIOverride);
    this.visual.update(session.ui, session.position, session.accepted);
    if (type === 'dragover' || type === 'drop' || session.accepted || args.Handled) event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = effectAllowed(session.accepted);
    if (type === 'drop' || type === 'dragleave') {
      this.visual.clear(); this.target = null;
      if (!session.source && type === 'drop') this.current = null;
    }
  }
  start(id, event, position) {
    const originalSource = id;
    id = this.dragSource(id);
    if (id == null) { event.preventDefault(); return; }
    const session = this.session(id), prepared = this.prepared.get(id);
    if (prepared) Object.assign(session, prepared, { data: validateDragData(prepared.data) });
    const args = { DragSession: session.id, DragEvent: 'DragStarting', DragSource: id, OriginalSource: originalSource,
      Cancel: session.cancel, Data: session.data,
      AllowedOperations: session.allowed, DragUI: dragVisualState(), Position: positionValue(position) };
    this.emit(id, 'DragStarting', args);
    session.cancel = !!args.Cancel;
    if (session.cancel) { event.preventDefault(); this.current = null; return; }
    session.data = validateDragData(args.Data); session.allowed = dragOperation(args.AllowedOperations);
    session.ui = dragVisualState(args.DragUI); this.source = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = effectAllowed(session.allowed);
      writeDragData(event.dataTransfer, session.data);
      // An internal format keeps a native drag alive while a worker prepares text. It contains no application data.
      if (!session.data.values.length) event.dataTransfer.setData('application/x-sharpforge-drag', session.id);
    }
    this.visual.start(event.dataTransfer, session.ui);
  }
  end(event) {
    const session = this.current;
    if (session?.source) this.emit(session.source, 'DropCompleted', { DragSession: session.id, DragSource: session.source,
      DropResult: session.cancel ? 0 : operationFromEffect(event.dataTransfer?.dropEffect ?? 'none') || session.accepted });
    this.current = null; this.source = null; this.target = null; this.visual.clear();
  }
  reply(command) {
    if (typeof command.session !== 'string' || command.session.length > 64) throw new TypeError('SFUI1666: Invalid drag session');
    const session = this.sessions.get(command.session);
    if (!session || session.expires <= this.now()) return false;
    if (command.event === 'DragStarting') {
      if (command.id !== session.source) throw new Error('SFUI1666: Drag reply source mismatch');
      session.data = validateDragData(command.data ?? session.data);
      session.allowed = dragOperation(command.allowedOperations ?? session.allowed);
      session.cancel = !!command.cancel;
    } else if (['DragEnter', 'DragOver', 'DragLeave', 'Drop'].includes(command.event)) {
      if (command.id !== session.target) return false;
      session.accepted = preferredOperation(dragOperation(command.acceptedOperation ?? 0) & session.allowed);
    } else throw new TypeError('SFUI1666: Unsupported drag reply');
    if (command.dragUI) session.ui = dragVisualState(command.dragUI);
    if (this.current === session && this.target) this.visual.update(session.ui, session.position, session.accepted);
    if (session.cancel) this.visual.clear();
    return true;
  }
  removeNode(id) {
    this.prepared.delete(id);
    for (const [key, session] of this.sessions) if (session.source === id || session.target === id) {
      if (session === this.current) { this.current = null; this.visual.clear(); }
      this.sessions.delete(key);
    }
  }
  reset() {
    this.sessions.clear(); this.prepared.clear(); this.current = null; this.source = null; this.target = null;
    this.files.dispose(); this.files = new DropFileBroker(this.dataPolicy); this.visual.clear();
  }
  dispose() { this.sessions.clear(); this.prepared.clear(); this.current = null; this.files.dispose(); this.visual.dispose(); }
}
