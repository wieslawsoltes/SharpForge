import {node} from './dom.js';
import {serviceItems} from '../services/providers.js';

function flattenSymbols(symbols, parent = null, result = []) {
  for (const symbol of symbols) {
    result.push({...symbol, parent: symbol.parent ?? parent});
    if (symbol.children) flattenSymbols(symbol.children, symbol.name, result);
  }
  return result;
}

export class NavigationBar {
  constructor(context) {
    this.context = context;
    this.element = node(context.document, 'nav', {className: 'sf-editor-navigation', 'aria-label': 'Code navigation', hidden: true});
    this.projects = this.select('Project');
    this.types = this.select('Type');
    this.members = this.select('Member');
    this.element.append(this.projects, this.types, this.members);
    context.editor.element.append(this.element);
    context.lifetime.listen(this.projects, 'change', () => {
      const project = this.projectItems?.find(item => item.id === this.projects.value);
      if (project?.uri) context.navigate({uri: project.uri, start: 0, end: 0});
      context.options.onProjectChange?.(project);
    });
    context.lifetime.listen(this.types, 'change', () => {
      this.selectedType = this.types.value;
      this.updateMembers();
      this.go(this.symbols.find(symbol => symbol.name === this.selectedType));
    });
    context.lifetime.listen(this.members, 'change', () => this.go(this.symbols[Number(this.members.value)]));
    this.symbols = [];
  }

  select(label) { return node(this.context.document, 'select', {'aria-label': label}); }

  async refresh() {
    if (!this.context.services.supports('documentSymbols')) return;
    const result = await this.context.request('documentSymbols', {});
    if (!result) return;
    this.symbols = flattenSymbols(serviceItems(result.value)).map(symbol => ({...symbol,
      start: symbol.start ?? this.context.editor.sourceSnapshot().offsetAt(symbol.selectionRange?.start ?? symbol.range.start),
      end: symbol.bodyEnd ?? symbol.end ?? this.context.editor.sourceSnapshot().offsetAt(symbol.range.end)
    })).sort((left, right) => left.name.localeCompare(right.name));
    const types = this.symbols.filter(symbol => ['class', 'struct', 'interface', 'enum', 'namespace', 5, 10, 11, 23].includes(symbol.kind));
    this.types.replaceChildren(node(this.context.document, 'option', {value: ''}, '(All types)'),
      ...types.map(symbol => node(this.context.document, 'option', {value: symbol.name}, symbol.name)));
    this.projects.replaceChildren(node(this.context.document, 'option', {value: ''}, this.context.options.projectName ?? 'Current project'));
    this.element.hidden = false;
    if (this.context.services.supports('projects')) {
      const projects = await this.context.request('projects', {});
      if (projects) {
        this.projectItems = serviceItems(projects.value);
        this.projects.replaceChildren(...this.projectItems.map(project => node(this.context.document, 'option', {value: project.id}, project.name)));
      }
    }
    this.updateMembers();
    this.cursor();
  }

  updateMembers() {
    this.members.replaceChildren(node(this.context.document, 'option', {value: ''}, '(Members)'), ...this.symbols.map((symbol, index) => ({symbol, index}))
      .filter(({symbol}) => !this.selectedType || symbol.owner === this.selectedType ||
        symbol.parent === this.selectedType || symbol.name === this.selectedType)
      .map(({symbol, index}) => node(this.context.document, 'option', {value: index}, symbol.detail ?? symbol.name)));
  }

  cursor() {
    const offset = this.context.editor.offset;
    const containing = this.symbols.filter(symbol => symbol.start <= offset && symbol.end >= offset)
      .sort((left, right) => left.end - left.start - (right.end - right.start));
    const current = containing[0];
    if (!current) return;
    const type = current.owner ?? current.parent ?? (['class', 'struct', 'interface', 'enum'].includes(current.kind) ? current.name : '');
    if (this.selectedType !== type) {
      this.selectedType = type;
      this.types.value = type;
      this.updateMembers();
    }
    this.members.value = String(this.symbols.indexOf(current));
  }

  go(symbol) {
    if (symbol) this.context.editor.goto(symbol.start, symbol.selectionEnd ?? symbol.start);
    this.context.editor.focus();
  }

  focus() { this.element.hidden = false; this.types.focus(); }
  dispose() { this.element.remove(); }
}
