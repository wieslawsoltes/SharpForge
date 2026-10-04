import {button, element, input, select, runAction} from '../ui.js';

export class ToolboxProviders {
  constructor() { this.providers = new Map(); }
  register(id, provider) {
    if (!id || this.providers.has(id) || typeof provider.items !== 'function') throw new TypeError('Invalid toolbox provider');
    this.providers.set(id, provider);
    return () => this.providers.delete(id);
  }
  async items(context, signal) {
    const result = [];
    for (const [id, provider] of this.providers) {
      signal?.throwIfAborted();
      if (!provider.matches(context)) continue;
      const items = await provider.items(context, signal);
      result.push(...items.map(item => ({...item, providerId: id, group: item.group ?? provider.title,
        insert: () => provider.insert(item, context)})));
    }
    return result;
  }
}

export function mountToolbox(host, {providers, context, onError}) {
  const document = host.ownerDocument;
  let items = [], query = '', group = 'all', generation = 0;
  const controller = new AbortController();
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const body = element(document, 'div', {className: 'wb-toolbox-items'});
  const groups = select(document, 'Toolbox tab', [{value: 'all', label: 'All'}], group, value => { group = value; render(); });
  host.replaceChildren(toolbar, body);
  const render = () => {
    body.replaceChildren();
    for (const item of items.filter(item => (group === 'all' || item.group === group) &&
      `${item.label} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase()))) {
      const control = button(document, item.label, runAction(item.insert, onError), {draggable: 'true', title: item.description ?? item.label});
      control.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('application/x-sharpforge-toolbox', JSON.stringify({providerId: item.providerId, id: item.id}));
        if (item.type) event.dataTransfer?.setData('application/x-sharpforge-control', item.type);
        if (item.text) event.dataTransfer?.setData('text/plain', item.text);
      });
      body.append(control);
    }
    if (!body.childElementCount) body.append(element(document, 'p', {text: 'No toolbox contributions for the active document.'}));
  };
  toolbar.append(groups, input(document, 'Search Toolbox', '', value => { query = value; render(); }));
  const refresh = runAction(async () => {
    const request = ++generation;
    const next = await providers.items(context(), controller.signal);
    if (controller.signal.aborted || request !== generation) return;
    items = next;
    groups.replaceChildren(element(document, 'option', {value: 'all', text: 'All'}), ...[...new Set(items.map(item => item.group))]
      .map(value => element(document, 'option', {value, text: value})));
    groups.value = group;
    render();
  }, onError);
  refresh();
  return {refresh, dispose: () => controller.abort()};
}
