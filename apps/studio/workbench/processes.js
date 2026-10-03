import { element, actionButton } from './session-dom.js';

export function processRows(sessions) {
  return sessions.list().map(session => ({
    id: session.id, name: session.name, projectId: session.projectId, state: session.state,
    debugging: session.debugging, selected: sessions.activeId === session.id, ...session.resources()
  }));
}

/** Processes window actions close over the row's app identity, never the active app by accident. */
export function mountProcesses(root, { sessions, onError = error => { throw error; } }) {
  const document = root.ownerDocument;
  const title = element(document, 'h2', 'Processes');
  const summary = element(document, 'p', '', { role: 'status', 'aria-live': 'polite' });
  const table = element(document, 'table', null, { class: 'data-table' });
  const head = element(document, 'thead');
  const row = element(document, 'tr');
  for (const label of ['Application', 'Id', 'State', 'Engine', 'Debugging', 'Heap', 'Worker', 'Actions']) {
    row.append(element(document, 'th', label, { scope: 'col' }));
  }
  head.append(row);
  const body = element(document, 'tbody');
  table.append(head, body);
  root.replaceChildren(title, summary, table);
  const report = error => { summary.textContent = error.message; onError(error); };
  const render = () => {
    const resources = sessions.resources();
    summary.textContent = `${resources.live} active applications · ${resources.count}/${resources.limit} workers`;
    body.replaceChildren(...processRows(sessions).map(value => {
      const session = sessions.get(value.id);
      const item = element(document, 'tr', null, { 'data-session-id': value.id, 'aria-selected': value.selected });
      const select = actionButton(document, value.name, () => sessions.setActive(value.id), report);
      const name = element(document, 'td');
      name.append(select);
      item.append(name);
      const values = [value.id, value.state, value.engine, value.debugging ? 'Attached' : 'Detached',
        value.heapBytes === null ? 'Unavailable' : `${value.heapBytes.toLocaleString()} B`, `${value.worker}, ${value.pendingRequests} pending`];
      for (const text of values) item.append(element(document, 'td', text));
      const actions = element(document, 'td');
      const definitions = [
        ['Break', () => session.request('pause'), session.live && session.state !== 'paused'],
        ['Continue', () => session.request('resume', { mode: 'continue' }), session.state === 'paused'],
        ['Stop', () => session.stop(), session.live],
        ['Detach', () => session.detach(), session.debugging && session.live],
        ['Restart', () => session.restart(), !!session.lastLaunch]
      ];
      for (const [label, action, enabled] of definitions) {
        const button = actionButton(document, label, action, report);
        button.disabled = !enabled;
        button.setAttribute('aria-label', `${label} ${value.name}`);
        actions.append(button);
      }
      item.append(actions);
      return item;
    }));
  };
  const dispose = sessions.subscribe(render);
  render();
  return { render, dispose() { dispose(); root.replaceChildren(); } };
}
