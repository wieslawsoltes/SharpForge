import {VirtualTable} from './virtual-table.js';
import {button, checkbox, element, field, input, select, copyText, runAction} from '../ui.js';

/** Changing a result scope filters the retained snapshot and never starts another compiler or search request. */
export function filterFindResults(result, scope, search) {
  if (!result) return [];
  if (!scope || scope.value === 'solution') return result.matches;
  if (scope.value.startsWith('session:')) {
    const projectId = search.sessionProject?.(scope.value.slice(8));
    return result.matches.filter(row => projectId && row.projectId === projectId);
  }
  return result.matches.filter(row => scope.matches(row, search.context()));
}

export function mountFindResults(host, {search, navigate, tasks, onError, initial, instanceId, scopeSelector, replace = false}) {
  const document = host.ownerDocument;
  let result = initial;
  let scope = scopeSelector?.value ?? 'solution';
  let regex = false, matchCase = false, wholeWord = false, keepResults = false;
  let instance = initial?.id ?? instanceId ?? 'find-results-1';
  let operation;
  const selected = new Set();
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const gridHost = element(document, 'div', {className: 'wb-grid-host'});
  const details = element(document, 'pre', {className: 'wb-preview', 'aria-label': 'Match preview'});
  const status = element(document, 'p', {role: 'status', className: 'wb-tool-status'});
  const query = input(document, 'Find what', initial?.query ?? '');
  const replacement = input(document, 'Replace with', '');
  const globs = input(document, 'File types', '*.cs;*.xaml');
  const columns = [
    {id: 'projectId', title: 'Project', width: '130px'}, {id: 'uri', title: 'File', width: 'minmax(160px, 1fr)'},
    {id: 'line', title: 'Line', width: '60px'}, {id: 'preview', title: 'Match', width: 'minmax(250px, 2fr)'}
  ];
  if (replace) columns.unshift({id: 'replace', title: 'Replace', width: '70px', render(cell, row) {
    const control = element(document, 'input', {type: 'checkbox', checked: selected.has(row.id), 'aria-label': 'Replace ' + row.uri + ':' + (row.line + 1)});
    control.addEventListener('change', () => control.checked ? selected.add(row.id) : selected.delete(row.id));
    cell.append(control);
  }});
  host.replaceChildren(toolbar, gridHost, details, status);
  const grid = new VirtualTable(gridHost, {columns, label: 'Find Results',
    format: (row, column) => column.id === 'line' ? row.line + 1 : row[column.id] ?? '',
    onActivate: runAction(navigate, onError), onSelect: row => {
      details.textContent = replace ? `Before: ${row.matchedText}\nAfter: ${row.replacement}` : row.preview;
    }});
  const render = (snapshot, resetSelection = true) => {
    result = snapshot;
    if (resetSelection) {
      selected.clear();
      for (const match of result.matches) selected.add(match.id);
    }
    const rows = filterFindResults(result, scopeSelector, search);
    grid.setRows(rows);
    status.textContent = `${rows.length} of ${result.matches.length} matches · ${result.scannedFiles} files scanned` +
      (result.truncated ? ' · result limit reached' : '');
  };
  const run = runAction(async () => {
    operation?.cancel();
    operation = tasks.begin({label: replace ? 'Replace preview' : 'Find in Files'});
    try {
      const snapshot = await search.run(query.value, {instance, scope, regex, matchCase, wholeWord, globs: globs.value,
        keepResults, replacement: replace ? replacement.value : undefined, signal: operation.signal,
        onProgress: progress => { status.textContent = progress.scannedFiles + ' files scanned · ' + progress.matches + ' matches'; }});
      instance = snapshot.id;
      render(snapshot);
      operation.complete();
    } catch (error) { operation.fail(error); if (error.name !== 'AbortError') throw error; }
  }, onError);
  toolbar.append(field(document, 'Find what', query));
  if (replace) toolbar.append(field(document, 'Replace with', replacement));
  if (scopeSelector) scopeSelector.mount(toolbar, () => {
    scope = scopeSelector.value;
    if (result) render(result, false);
  });
  else toolbar.append(select(document, 'Look in', [{value: 'solution', label: 'Entire solution'}, {value: 'project', label: 'Current project'},
    {value: 'document', label: 'Current document'}, {value: 'open', label: 'Open documents'}], scope, value => { scope = value; }));
  toolbar.append(field(document, 'File types', globs), checkbox(document, 'Regex', regex, value => { regex = value; }),
    checkbox(document, 'Match case', matchCase, value => { matchCase = value; }),
    checkbox(document, 'Whole word', wholeWord, value => { wholeWord = value; }),
    checkbox(document, 'Keep results', keepResults, value => { keepResults = value; }));
  toolbar.append(select(document, 'Find Results window', [...new Set([instance, 'find-results-1', 'find-results-2'])], instance, value => {
    instance = value;
    const snapshot = search.results.get(value);
    if (snapshot) render(snapshot);
  }));
  toolbar.append(button(document, replace ? 'Preview replacements' : 'Find All', run), button(document, 'Cancel search', () => operation?.cancel()));
  toolbar.append(checkbox(document, 'Lock results', result?.locked ?? false, value => { if (result) result.locked = value; }));
  toolbar.append(button(document, 'Copy results', runAction(() => copyText(filterFindResults(result, scopeSelector, search)
    .map(row => `${row.uri}(${row.line + 1},${row.character + 1}): ${row.preview}`).join('\n')), onError)));
  if (replace) toolbar.append(button(document, 'Replace selected', runAction(async () => {
    if (!result) throw new Error('Preview replacements first');
    const checked = filterFindResults(result, scopeSelector, search).filter(row => selected.has(row.id)).map(row => row.id);
    const applied = await search.replace(result.id, checked);
    status.textContent = applied.changedDocuments.length + ' documents changed; ' + applied.skipped.length + ' stale matches skipped';
  }, onError)));
  query.addEventListener('keydown', event => { if (event.key === 'Enter') run(); });
  if (result) render(result);
  return {refresh: () => {}, setResults: render, dispose: () => { operation?.cancel(); grid.dispose(); }};
}
