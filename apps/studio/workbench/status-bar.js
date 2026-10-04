import {button, element, runAction} from './ui.js';
import {SourceText, analyzeEol} from '@sharpforge/text';
import {StatusPosition} from './status-position.js';

/** Regions update their text in place and contribute independent actions and subscriptions. */
export class WorkbenchStatusBar {
  constructor(host, {onError}) {
    this.host = host;
    this.onError = onError;
    this.regions = new Map();
    this.root = element(host.ownerDocument, 'div', {className: 'wb-statusbar', role: 'toolbar', 'aria-label': 'Status bar'});
    host.append(this.root);
  }
  register({id, label, value, action, subscribe, priority = 0}) {
    if (!id || this.regions.has(id) || typeof value !== 'function') throw new TypeError('Invalid status region');
    const node = button(this.host.ownerDocument, '', runAction(() => action?.(), this.onError), {'aria-label': label, title: label});
    const update = () => {
      const current = value();
      node.hidden = current === null || current === undefined;
      if (current !== null && current !== undefined && node.textContent !== String(current)) node.textContent = String(current);
      node.title = label + ': ' + (current ?? '');
      node.setAttribute('aria-label', node.title);
    };
    const region = {id, node, update, priority, unsubscribe: subscribe?.(update)};
    this.regions.set(id, region);
    const nodes = [...this.regions.values()].sort((left, right) => left.priority - right.priority);
    this.root.replaceChildren(...nodes.map(item => item.node));
    update();
    return () => { region.unsubscribe?.(); region.node.remove(); this.regions.delete(id); };
  }
  update() { for (const region of this.regions.values()) region.update(); }
  dispose() { for (const region of this.regions.values()) region.unsubscribe?.(); this.regions.clear(); this.root.remove(); }
}

export function registerStatusRegions(bar, {context, documents, tasks, notifications, settings, execute}) {
  const legacySources = new WeakMap();
  let updateCursor;
  const positionStatus = new StatusPosition({onChange: () => updateCursor?.(), onError: error => bar.onError?.(error)});
  const documentState = () => {
    const current = context();
    const record = documents.get(current.uri);
    if (!record) return {current};
    const model = documents.models?.get(current.uri) ?? record.model;
    if (model) return {current, record, source: model, metadata: model.metadata};
    let cached = legacySources.get(record);
    if (cached?.version !== record.version) cached = null;
    if (!cached) {
      const text = Object.getOwnPropertyDescriptor(record, 'text')?.value;
      cached = {version: record.version, metadata: record.metadata};
      // Legacy records have no indexed model. Inspect small eager strings once per version only.
      if (typeof text === 'string' && text.length <= 65536) {
        cached.source = new SourceText(text, record.uri, record.version);
        cached.metadata ??= analyzeEol(text, {encoding: record.encoding ?? 'utf-8'});
      }
      legacySources.set(record, cached);
    }
    return {current, record, ...cached};
  };
  const cursor = () => {
    const {current, record, source} = documentState();
    if (!record) { positionStatus.dispose(); return null; }
    const requestedOffset = current.caretOffset ?? current.offset ?? 0;
    if (!Number.isSafeInteger(requestedOffset)) {
      positionStatus.dispose();
      return null;
    }
    const length = source?.length ?? source?.buffer?.length;
    const offset = Number.isSafeInteger(length)
      ? Math.max(0, Math.min(requestedOffset, length)) : Math.max(0, requestedOffset);
    const reportedPosition = current.caretPosition ?? current.position;
    // Document changes reach this view before the editor publishes its new caret.
    const position = source?.positionAt?.(offset) ?? reportedPosition;
    if (!position) {
      positionStatus.dispose();
      return null;
    }
    const samePosition = !reportedPosition ||
      reportedPosition.line === position.line && reportedPosition.character === position.character;
    const visualColumn = offset === requestedOffset && samePosition ? current.visualColumn : undefined;
    const column = positionStatus.column(source, position, {offset, visualColumn,
      tabSize: current.tabSize ?? settings.get('editor', 'tabSize') ?? 4});
    return {position, column, columnStatus: positionStatus.pending ? 'pending' : 'unavailable'};
  };
  const regions = [
    {id: 'message', label: 'Workbench status', value: () => context().status ?? 'Ready', priority: -100},
    {id: 'tasks', label: 'Background tasks', value: () => tasks.running.length ? `${tasks.running.length} tasks` : 'No tasks',
      action: () => execute('tool:background-tasks'), subscribe: listener => tasks.subscribe(listener)},
    {id: 'cursor', label: 'Line, visual column and line character', value: () => {
      const current = cursor();
      if (!current) return null;
      const {position, column, columnStatus} = current;
      return `Ln ${position.line + 1}, Col ${column === null ? columnStatus : column + 1}, Ch ${position.character + 1}`;
    }, action: () => execute('workbench.goToLine'), subscribe: listener => {
      updateCursor = listener;
      return () => { updateCursor = null; positionStatus.dispose(); };
    }},
    {id: 'selection', label: 'Selected characters', value: () => `${context().selectionLength ?? 0} selected`},
    {id: 'insert', label: 'Insert mode', value: () => context().overwrite ? 'OVR' : 'INS'},
    {id: 'indentation', label: 'Indentation', value: () =>
      `${settings.get('editor', 'insertSpaces') ? 'Spaces' : 'Tabs'}: ${settings.get('editor', 'tabSize')}`,
      action: () => execute('workbench.options')},
    {id: 'encoding', label: 'Document encoding', value: () => {
      const {record, metadata} = documentState();
      return record ? metadata?.encoding ?? record.encoding ?? 'UTF-8 export' : null;
    }},
    {id: 'line-ending', label: 'Line endings', value: () => {
      const {record, metadata} = documentState();
      if (!record) return null;
      const label = {'\r\n': 'CRLF', '\n': 'LF', '\r': 'CR'}[metadata?.dominantEol ?? metadata?.eol];
      return label ? label + (metadata.mixedEol ? ' (mixed)' : '') : 'EOL unavailable';
    }},
    {id: 'zoom', label: 'Editor zoom', value: () => settings.get('editor', 'zoom') + '%', action: () => execute('workbench.options')},
    {id: 'keymap', label: 'Keyboard mapping', value: () => context().keymap ?? settings.get('environment', 'keymap'),
      action: () => execute('workbench.keyboard')},
    {id: 'debug', label: 'Debug state', value: () => context().debugState ?? 'Stopped'},
    {id: 'notifications', label: 'Notifications', value: () => `${notifications.unread} notifications`,
      action: () => execute('tool:notifications'), subscribe: listener => notifications.subscribe(listener), priority: 100}
  ];
  return regions.map(region => bar.register(region));
}
