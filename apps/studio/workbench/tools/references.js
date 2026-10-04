import {WorkbenchEvents} from '../events.js';
import {createToolTree} from './tree-host.js';
import {button, checkbox, select, copyText, runAction} from '../ui.js';

export class ReferenceResults extends WorkbenchEvents {
  constructor() { super(); this.windows = new Map(); this.serial = 0; }
  set(rows, {id = 'references', keep = false, definition = ''} = {}) {
    if (keep || this.windows.get(id)?.locked) id = 'references:' + ++this.serial;
    if (rows.length > 100000) throw new RangeError('Reference result limit exceeded');
    if (!this.windows.has(id) && this.windows.size >= 20) {
      const oldest = [...this.windows.values()].find(item => !item.locked);
      if (!oldest) throw new Error('All 20 reference windows are locked; unlock one before keeping another result');
      this.windows.delete(oldest.id);
    }
    const result = {id, rows: rows.map((row, index) => ({...row, id: row.id ?? id + ':' + index,
      kind: row.kind ?? (row.declaration ? 'definition' : row.write ? 'write' : row.read ? 'read' : 'reference')})), definition, locked: false};
    this.windows.set(id, result);
    this.emit({type: 'results', result});
    return result;
  }
  groups(id, {groupBy = 'project', kind = 'all', filter = ''} = {}) {
    const result = this.windows.get(id);
    if (!result) return [];
    const groups = new Map();
    for (const row of result.rows) {
      if (kind !== 'all' && row.kind !== kind) continue;
      if (filter && !`${row.uri} ${row.preview ?? ''}`.toLowerCase().includes(filter.toLowerCase())) continue;
      const group = groupBy === 'project' ? row.projectId ?? '(workspace)' : groupBy === 'definition' ?
        row.definition ?? result.definition ?? '(symbol)' : row.uri;
      let parent = groups.get(group);
      if (!parent) groups.set(group, parent = {id: id + ':group:' + group, label: group, children: [], defaultExpanded: true});
      parent.children.push({id: row.id, label: `${row.uri}:${(row.line ?? 0) + 1} · ${row.kind}`,
        detail: row.preview ?? `${row.uri} UTF-16 span ${row.start}–${row.end}`, location: row, children: []});
    }
    return [...groups.values()];
  }
}

export function mountReferences(host, {model, id = 'references', navigate, newWindow, onError}) {
  let groupBy = 'project', kind = 'all';
  const tree = createToolTree(host, {label: 'Find All References', onError, onOpen: node => node.location && navigate(node.location)});
  const refresh = () => {
    const result = model.windows.get(id);
    tree.setNodes(model.groups(id, {groupBy, kind}));
    tree.status.textContent = result ? `${result.rows.length} references${result.locked ? ' · locked' : ''}` : 'Find references to a bound symbol.';
  };
  tree.toolbar.append(select(host.ownerDocument, 'Group references by', ['project', 'definition', 'file'], groupBy,
    value => { groupBy = value; refresh(); }));
  tree.toolbar.append(select(host.ownerDocument, 'Reference kind', ['all', 'read', 'write', 'definition', 'reference'], kind,
    value => { kind = value; refresh(); }));
  tree.toolbar.append(checkbox(host.ownerDocument, 'Lock results', false, value => {
    const result = model.windows.get(id); if (result) result.locked = value;
  }));
  tree.toolbar.append(button(host.ownerDocument, 'Keep in new window', () => {
    const result = model.windows.get(id); if (!result) return;
    const retained = model.set(result.rows, {keep: true, definition: result.definition});
    retained.locked = true;
    newWindow?.(retained.id);
  }));
  tree.toolbar.append(button(host.ownerDocument, 'Copy', runAction(() => copyText((model.windows.get(id)?.rows ?? [])
    .map(row => `${row.uri}\t${row.start}\t${row.end}\t${row.kind}`).join('\n')), onError)));
  refresh();
  return {refresh, dispose: () => tree.dispose()};
}
