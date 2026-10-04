import {VirtualTable} from './virtual-table.js';
import {button, checkbox, element, input, select, copyText, runAction} from '../ui.js';

/** Recognizes compiler-style path(line,column) and path:line:column spans without guessing a project. */
export function outputLocation(text, projectId) {
  const match = /(?:^|\s)((?:[A-Za-z]:[\\/])?[^\r\n<>|"?*]+?)\((\d+)(?:,(\d+))?\)/u.exec(text) ??
    /(?:^|\s)((?:[A-Za-z]:[\\/])?[^\r\n<>|"?*]+?):(\d+)(?::(\d+))?:/u.exec(text);
  if (!match) return null;
  const line = Number(match[2]), column = Number(match[3] ?? 1);
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null;
  return {uri: match[1].trim(), line: line - 1, character: column - 1, projectId};
}

export class OutputModel {
  constructor({channels, scope, context = () => ({}), maxLines = 100000}) {
    this.channels = channels;
    this.scope = scope;
    this.context = context;
    this.maxLines = maxLines;
    this.channelId = 'Build';
    this.search = '';
    this.wrap = false;
    this.timestamps = false;
    this.cache = null;
  }
  choices() {
    return this.channels.list().filter(channel => !this.scope || this.scope.matches(channel, this.context()) ||
      !channel.projectId && !channel.sessionId);
  }
  rows() {
    const channel = this.channels.get(this.channelId);
    if (!channel) return [];
    const key = channel.id + ':' + channel.revision;
    if (this.cache?.key !== key) {
      const rows = [];
      for (const entry of this.channels.read(channel.id, {count: Math.min(channel.count, this.maxLines)})) {
        const lines = entry.text.split(/\r?\n/u);
        if (!lines.at(-1)) lines.pop();
        const projectId = entry.metadata?.projectId ?? entry.projectId ?? channel.projectId;
        const sessionId = entry.metadata?.sessionId ?? entry.metadata?.appId ?? entry.sessionId ?? channel.sessionId;
        lines.forEach((text, index) => {
          const location = outputLocation(text, projectId);
          rows.push({id: entry.id + ':' + index, text, timestamp: entry.timestamp, projectId, sessionId,
            uri: entry.metadata?.uri ?? location?.uri, location});
        });
      }
      this.cache = {key, rows: rows.slice(-this.maxLines)};
    }
    const query = this.search.toLowerCase();
    const context = this.context();
    return this.cache.rows.filter(row => (!this.scope || this.scope.matches(row, context)) &&
      (!query || row.text.toLowerCase().includes(query)));
  }
}

export function mountOutput(host, {model, navigate, onError}) {
  const document = host.ownerDocument;
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const gridHost = element(document, 'div', {className: 'wb-grid-host'});
  const status = element(document, 'p', {className: 'wb-tool-status'});
  host.replaceChildren(toolbar, gridHost, status);
  const columns = () => model.timestamps ? [{id: 'timestamp', title: 'Time', width: '110px'}, {id: 'text', title: 'Message'}] :
    [{id: 'text', title: 'Message', width: 'minmax(500px, 1fr)'}];
  const grid = new VirtualTable(gridHost, {columns: columns(), label: 'Output', format: (row, column) =>
    column.id === 'timestamp' ? new Date(row.timestamp).toISOString().slice(11, 23) : row.text,
  onActivate: runAction(row => row.location ? navigate(row.location) : undefined, onError)});
  const chooser = select(document, 'Show output from', [], model.channelId, value => { model.channelId = value; refresh(); });
  const refresh = () => {
    const choices = model.choices();
    if (!choices.some(channel => channel.id === model.channelId)) model.channelId = choices[0]?.id ?? '';
    const ids = choices.map(channel => channel.id).join('\0');
    if (chooser.dataset.ids !== ids) {
      chooser.replaceChildren(...choices.map(channel => element(document, 'option', {value: channel.id, text: channel.name})));
      chooser.dataset.ids = ids;
    }
    chooser.value = model.channelId;
    const rows = model.rows();
    grid.setRows(rows);
    const channel = model.channels.get(model.channelId);
    status.textContent = `${rows.length} lines · ${channel?.dropped ?? 0} older output entries discarded by buffer limit`;
  };
  model.scope?.mount(toolbar, refresh);
  toolbar.append(chooser, button(document, 'Clear All', () => { model.channels.clear(model.channelId); refresh(); }));
  toolbar.append(checkbox(document, 'Word wrap', model.wrap, value => {
    model.wrap = value;
    grid.root.classList.toggle('wb-wrap', value);
    grid.rowHeight = value ? 56 : 28;
    grid.setRows(model.rows());
  }));
  toolbar.append(checkbox(document, 'Timestamps', model.timestamps, value => { model.timestamps = value; grid.setColumns(columns()); }));
  toolbar.append(input(document, 'Find in output', model.search, value => { model.search = value; refresh(); }));
  toolbar.append(button(document, 'Copy', runAction(() => copyText(model.rows().map(row => row.text).join('\n')), onError)));
  refresh();
  return {refresh, next: backwards => {
    const direction = backwards ? -1 : 1;
    let index = grid.index + direction;
    while (index >= 0 && index < grid.rows.length && !grid.rows[index].location) index += direction;
    if (index >= 0 && index < grid.rows.length) { grid.select(index); return navigate(grid.rows[index].location); }
  }, dispose: () => grid.dispose()};
}
