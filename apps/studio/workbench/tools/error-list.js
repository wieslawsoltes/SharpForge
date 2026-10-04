import {VirtualTable} from './virtual-table.js';
import {ScopeSelector} from './scope-selector.js';
import {button, checkbox, element, input, select, copyText, runAction} from '../ui.js';

export const errorColumns = Object.freeze([
  {id: 'severity', title: 'Severity', width: '90px'}, {id: 'code', title: 'Code', width: '95px'},
  {id: 'message', title: 'Description', width: 'minmax(280px, 3fr)'},
  {id: 'projectId', title: 'Project', width: 'minmax(120px, 1fr)'},
  {id: 'uri', title: 'File', width: 'minmax(160px, 1fr)'},
  {id: 'line', title: 'Line', width: '65px'}, {id: 'suppression', title: 'Suppression', width: '100px'}
]);
const severityOrder = {error: 0, warning: 1, info: 2, information: 2, message: 2, hint: 3};

export class ErrorListModel {
  constructor({diagnostics, scope = new ScopeSelector(), context = () => ({})}) {
    this.diagnostics = diagnostics;
    this.scope = scope;
    this.context = context;
    this.severities = new Set(['error', 'warning', 'message']);
    this.source = 'all';
    this.search = '';
    this.sort = 'severity';
    this.descending = false;
    this.columns = errorColumns.map(column => column.id);
  }
  rows() {
    const query = this.search.toLowerCase();
    const context = this.context();
    return this.diagnostics.query().filter(item => {
      const severity = ['error', 'warning'].includes(item.severity) ? item.severity : 'message';
      return this.severities.has(severity) && this.scope.matches(item, context) &&
        (this.source === 'all' || this.source === item.source) &&
        (!query || `${item.code} ${item.message} ${item.uri} ${item.projectId}`.toLowerCase().includes(query));
    }).map(item => ({...item, line: (item.range?.start.line ?? item.line ?? 0) + 1,
      suppression: item.suppressed ? 'Suppressed' : 'Active'})).sort((left, right) => {
      let order;
      if (this.sort === 'severity') order = severityOrder[left.severity] - severityOrder[right.severity];
      else if (this.sort === 'line') order = left.line - right.line;
      else order = String(left[this.sort] ?? '').localeCompare(String(right[this.sort] ?? ''));
      return (this.descending ? -order : order) || left.id.localeCompare(right.id);
    });
  }
  copy(rows = this.rows()) {
    return [this.columns.join('\t'), ...rows.map(row => this.columns.map(column => String(row[column] ?? '')
      .replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'))].join('\n');
  }
}

export function mountErrorList(host, {model, navigate, dialogs, onError}) {
  const document = host.ownerDocument;
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const gridHost = element(document, 'div', {className: 'wb-grid-host'});
  const status = element(document, 'p', {className: 'wb-tool-status', role: 'status'});
  host.replaceChildren(toolbar, gridHost, status);
  const grid = new VirtualTable(gridHost, {label: 'Error List', columns: errorColumns,
    onActivate: runAction(row => navigate({...row, end: row.start + (row.length ?? 0)}), onError)});
  const refresh = () => { const rows = model.rows(); grid.setRows(rows); status.textContent = rows.length + ' diagnostics'; };
  for (const severity of ['error', 'warning', 'message']) {
    toolbar.append(checkbox(document, severity + 's', model.severities.has(severity), checked => {
      if (checked) model.severities.add(severity); else model.severities.delete(severity);
      refresh();
    }));
  }
  model.scope.mount(toolbar, refresh);
  toolbar.append(select(document, 'Diagnostic source', [
    {value: 'all', label: 'Build + IntelliSense'}, {value: 'build', label: 'Build Only'},
    {value: 'analysis', label: 'IntelliSense Only'}
  ], model.source, value => { model.source = value; refresh(); }));
  toolbar.append(input(document, 'Search diagnostics', model.search, value => { model.search = value; refresh(); }));
  toolbar.append(select(document, 'Sort diagnostics by', errorColumns.map(column => ({value: column.id, label: column.title})),
    model.sort, value => { model.sort = value; refresh(); }));
  toolbar.append(button(document, 'Reverse sort', () => { model.descending = !model.descending; refresh(); }));
  toolbar.append(button(document, 'Columns', () => dialogs.open({title: 'Error List Columns', render: body => {
    for (const column of errorColumns) body.append(checkbox(document, column.title, model.columns.includes(column.id), checked => {
      model.columns = checked ? [...model.columns, column.id] : model.columns.filter(id => id !== column.id);
      grid.setColumns(errorColumns.filter(item => model.columns.includes(item.id)));
    }));
  }, actions: [{label: 'Close', run: () => true}]})));
  toolbar.append(button(document, 'Copy', runAction(() => copyText(model.copy()), onError)));
  refresh();
  return {refresh, next: backwards => { grid.select(grid.index + (backwards ? -1 : 1));
    if (grid.rows[grid.index]) return navigate(grid.rows[grid.index]); }, dispose: () => grid.dispose()};
}
