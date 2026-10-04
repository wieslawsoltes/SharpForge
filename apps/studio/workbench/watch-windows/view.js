import { element, replaceOptions, selectField } from '../session-dom.js';

/** Retained expression inputs do not lose focus when asynchronously evaluated values arrive. */
export function mountWatchWindow(host, { model, onError }) {
  const document = host.ownerDocument;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const title = `Watch ${model.record.instance}`;
  const toolbar = element(document, 'div', null, { class: 'panel-tools' });
  const selector = selectField(document, `${title} application`);
  const refresh = element(document, 'button', 'Refresh', { type: 'button', 'aria-label': `Refresh ${title}` });
  const form = element(document, 'form');
  const input = element(document, 'input', null, { 'aria-label': `Add expression to ${title}`, maxlength: 4096 });
  const add = element(document, 'button', 'Add expression', { type: 'submit' });
  const status = element(document, 'p', null, { role: 'status', 'aria-live': 'polite' });
  const table = element(document, 'table', null, { class: 'data-table', 'aria-label': `${title} expressions` });
  const head = element(document, 'thead');
  const headings = element(document, 'tr');
  for (const name of ['Expression', 'Value', 'Type', 'Actions']) headings.append(element(document, 'th', name, { scope: 'col' }));
  head.append(headings);
  const body = element(document, 'tbody');
  table.append(head, body);
  toolbar.append(selector.wrapper, refresh);
  form.append(input, add);
  host.append(toolbar, form, status, table);
  const rows = new Map();
  let selectorKey;
  const act = callback => {
    try { Promise.resolve(callback()).catch(onError); } catch (error) { onError(error); }
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    const expression = input.value;
    act(() => { const pending = model.add(expression); input.value = ''; input.focus?.(); return pending; });
  }, options);
  selector.select.addEventListener('change', () => {
    const target = selector.select.value;
    act(() => model.select(target));
  }, options);
  refresh.addEventListener('click', () => act(() => model.refresh({ force: true })), options);

  const createRow = expression => {
    const row = element(document, 'tr');
    const name = element(document, 'td');
    const editor = element(document, 'input', null, { 'aria-label': `Expression ${expression} in ${title}`, maxlength: 4096 });
    editor.value = expression;
    name.append(editor);
    const value = element(document, 'td');
    const type = element(document, 'td');
    const actions = element(document, 'td');
    const remove = element(document, 'button', 'Remove', { type: 'button', 'aria-label': `Remove ${expression} from ${title}` });
    actions.append(remove);
    row.append(name, value, type, actions);
    editor.addEventListener('change', () => act(() => {
      try { return model.replace(expression, editor.value); }
      catch (error) { editor.value = expression; throw error; }
    }), options);
    remove.addEventListener('click', () => act(() => model.remove(expression)), options);
    body.append(row);
    return { row, editor, value, type };
  };

  const render = () => {
    const applications = model.sessions.list().map(session => ({ value: `session:${session.id}`, label: `${session.name} (${session.id})` }));
    if (model.target !== 'active' && !model.session) {
      applications.push({ value: model.target, label: `Unavailable application (${model.target.slice(8)})` });
    }
    const key = JSON.stringify([applications, model.target]);
    if (key !== selectorKey) {
      replaceOptions(selector.select, [{ value: 'active', label: 'Active application' }, ...applications], model.target);
      selectorKey = key;
    }
    for (const [expression, value] of rows) {
      if (model.expressions.includes(expression)) continue;
      value.row.remove();
      rows.delete(expression);
    }
    for (const expression of model.expressions) {
      let row = rows.get(expression);
      if (!row) { row = createRow(expression); rows.set(expression, row); }
      const result = model.values.get(expression);
      const value = result?.error ?? result?.result ?? '—';
      const type = result?.error ? 'Error' : result?.type ?? '';
      if (row.value.textContent !== value) row.value.textContent = value;
      if (row.type.textContent !== type) row.type.textContent = type;
    }
    if (status.textContent !== model.status) status.textContent = model.status;
    refresh.disabled = model.session?.state !== 'paused';
  };
  const unsubscribe = model.subscribe(render);
  render();
  return { render, dispose() { controller.abort(); unsubscribe(); host.replaceChildren(); rows.clear(); } };
}
