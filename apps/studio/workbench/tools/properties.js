import {button, element, input, select, runAction} from '../ui.js';

export class PropertiesProviderRegistry {
  constructor() { this.providers = new Map(); }
  register(id, provider) {
    if (this.providers.has(id) || typeof provider.get !== 'function') throw new TypeError('Invalid properties provider');
    this.providers.set(id, provider);
    return () => this.providers.delete(id);
  }
  get(context) {
    for (const [id, provider] of [...this.providers].reverse()) {
      if (provider.matches(context)) return {providerId: id, ...provider.get(context)};
    }
    return {title: 'No selection', properties: []};
  }
}

export function createDefaultProperties({state, designer}) {
  const registry = new PropertiesProviderRegistry();
  registry.register('solution', {
    matches: () => true,
    get: () => {
      const selected = state().itemSelection?.[0];
      if (!selected) return {title: 'No selection', properties: []};
      const properties = {Name: selected.label, Kind: selected.kind, Path: selected.path, Project: selected.project,
        'Build Action': selected.itemType, Included: selected.included, ...selected.metadata};
      return {title: selected.label, properties: Object.entries(properties).map(([name, value]) => ({
        name, value: value ?? '', category: name === 'Build Action' || name === 'Included' ? 'Build' : 'General', readOnly: true,
        description: name === 'Path' ? 'Workspace-relative path of the selected item.' : name
      }))};
    }
  });
  registry.register('designer', {
    matches: context => context.activeDocumentKind === 'designer' && Boolean(designer?.()?.document),
    get: () => {
      const document = designer().document;
      const selected = document.node();
      return {title: selected?.properties.Name ?? selected?.type ?? 'Designer',
        properties: Object.entries(selected?.properties ?? {}).map(([name, value]) => ({
          name, value, category: ['Left', 'Top', 'Width', 'Height', 'Margin', 'Padding'].includes(name) ? 'Layout' : 'Appearance',
          type: typeof value, description: name + ' on ' + selected.type,
          set: next => document.setProperty(name, typeof value === 'number' ? Number(next) : next)
        }))};
    }
  });
  return registry;
}

export function mountProperties(host, {providers, context, onError}) {
  const document = host.ownerDocument;
  let mode = 'category';
  let query = '';
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const body = element(document, 'div', {className: 'wb-property-list'});
  const description = element(document, 'p', {className: 'wb-preview', 'aria-label': 'Property description'});
  host.replaceChildren(toolbar, body, description);
  const refresh = () => {
    const selection = providers.get(context());
    body.replaceChildren(element(document, 'h3', {text: selection.title}));
    const properties = selection.properties.filter(property => property.name.toLowerCase().includes(query.toLowerCase()));
    properties.sort((left, right) => (mode === 'category' ? left.category.localeCompare(right.category) : 0) || left.name.localeCompare(right.name));
    let category;
    for (const property of properties) {
      if (mode === 'category' && category !== property.category) {
        category = property.category;
        body.append(element(document, 'h4', {text: category}));
      }
      const row = element(document, 'label', {className: 'wb-property'});
      row.append(element(document, 'span', {text: property.name}));
      const control = input(document, property.name, typeof property.value === 'object' ? JSON.stringify(property.value) : property.value);
      control.readOnly = property.readOnly || !property.set;
      if (property.type === 'boolean') { control.type = 'checkbox'; control.checked = property.value; }
      control.addEventListener('focus', () => { description.textContent = property.description ?? property.name; });
      control.addEventListener('change', runAction(() => property.set?.(property.type === 'boolean' ? control.checked : control.value), onError));
      row.append(control);
      body.append(row);
    }
    if (!properties.length) body.append(element(document, 'p', {text: 'Select a file, project or designer control to view its properties.'}));
  };
  toolbar.append(select(document, 'Property ordering', [{value: 'category', label: 'Categorized'}, {value: 'name', label: 'Alphabetical'}],
    mode, value => { mode = value; refresh(); }));
  toolbar.append(input(document, 'Search properties', '', value => { query = value; refresh(); }));
  refresh();
  return {refresh, dispose() {}};
}
