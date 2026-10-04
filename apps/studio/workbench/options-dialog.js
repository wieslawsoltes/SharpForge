import {element, input, button} from './ui.js';

/** Pages edit a detached settings transaction; one apply publishes all categories atomically. */
export class OptionsDialog {
  constructor({dialogs, settings}) {
    this.dialogs = dialogs;
    this.settings = settings;
    this.pages = new Map();
  }
  register(page) {
    if (!page?.id || typeof page.title !== 'string' || typeof page.render !== 'function') throw new TypeError('Invalid options page');
    if (this.pages.has(page.id)) throw new Error('Duplicate options page ' + page.id);
    this.pages.set(page.id, {...page});
    return () => this.pages.delete(page.id);
  }
  list(query = '') {
    const terms = query.toLowerCase().trim().split(/\s+/u);
    return [...this.pages.values()].filter(page => terms.every(term =>
      `${page.category} ${page.title} ${(page.keywords ?? []).join(' ')}`.toLowerCase().includes(term)));
  }
  open(initialPage) {
    const draft = this.settings.snapshot();
    const changes = {};
    let selected = initialPage ?? this.pages.keys().next().value;
    let pageCleanup;
    const handle = this.dialogs.open({
      title: 'Options',
      render: (host, dialog) => {
        const document = host.ownerDocument;
        const search = input(document, 'Search options', '', () => renderTree(search.value), {placeholder: 'Search options'});
        const layout = element(document, 'div', {className: 'wb-options-layout'});
        const tree = element(document, 'nav', {className: 'wb-options-tree', role: 'tree', 'aria-label': 'Options pages'});
        const pageHost = element(document, 'section', {className: 'wb-options-page'});
        const show = id => {
          pageCleanup?.();
          selected = id;
          pageHost.replaceChildren();
          const page = this.pages.get(id);
          if (!page) return;
          pageHost.append(element(document, 'h3', {text: page.category + ' / ' + page.title}));
          pageCleanup = page.render(pageHost, {draft, signal: dialog.signal, update: (category, key, value) => {
            draft[category] ??= {};
            draft[category][key] = value;
            changes[category] ??= {};
            changes[category][key] = value;
          }});
          for (const node of tree.querySelectorAll('[data-page]')) {
            node.setAttribute('aria-selected', String(node.dataset.page === id));
            node.tabIndex = node.dataset.page === id ? 0 : -1;
          }
        };
        const renderTree = query => {
          tree.replaceChildren();
          let category;
          const pages = this.list(query);
          const tabbable = pages.some(page => page.id === selected) ? selected : pages[0]?.id;
          for (const page of pages) {
            if (category !== page.category) {
              category = page.category;
              tree.append(element(document, 'div', {className: 'wb-options-category', text: category, role: 'presentation'}));
            }
            tree.append(button(document, page.title, () => show(page.id), {
              role: 'treeitem', 'data-page': page.id, 'aria-selected': page.id === selected, tabIndex: page.id === tabbable ? 0 : -1
            }));
          }
        };
        tree.addEventListener('keydown', event => {
          const items = [...tree.querySelectorAll('button')];
          let index = items.indexOf(document.activeElement);
          if (event.key === 'ArrowDown') index++;
          else if (event.key === 'ArrowUp') index--;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = items.length - 1;
          else return;
          event.preventDefault();
          items[Math.max(0, Math.min(items.length - 1, index))]?.focus();
        });
        search.addEventListener('keydown', event => {
          if (!['ArrowDown', 'Enter'].includes(event.key)) return;
          const first = tree.querySelector('[data-page]');
          if (!first) return;
          event.preventDefault();
          if (event.key === 'Enter') show(first.dataset.page);
          first.focus();
        });
        layout.append(tree, pageHost);
        host.append(search, layout);
        renderTree('');
        show(selected);
        return () => pageCleanup?.();
      },
      actions: [{label: 'OK', run: () => {
        for (const page of this.pages.values()) page.validate?.(draft);
        this.settings.apply(changes, {clearWorkspaceOverrides: true});
        return true;
      }}]
    });
    return handle;
  }
}
