import {
  DesignDocument, DesignerToolboxCatalog, insertToolboxControl, toolboxInsertionParent
} from '../../packages/designer/src/index.js';
import {icon} from './icons.js';
import {escapeHtml as escape} from '../../packages/editor/src/index.js';

const categoryIcons = {Layout: 'layout', Input: 'file', Drawing: 'layers', Controls: 'boxes', Project: 'solution'};

/** Searchable, tabbed toolbox that consumes successful project analysis without executing controls. */
export class DesignerToolbox {
  constructor(view, {catalog = new DesignerToolboxCatalog()} = {}) {
    this.view = view;
    this.catalog = catalog;
    this.tab = 'common';
    this.groups = new Map();
    this.root = null;
    this.disposed = false;
  }

  install() {
    if (this.root || this.disposed) return;
    this.root = this.view.panel('designer-toolbox');
    this.root.classList.add('design-side');
    this.root.innerHTML = '<div class="panel-tools"><b>Toolbox</b>' +
      '<button type="button" data-toolbox-pointer aria-pressed="true">Pointer</button></div>' +
      '<div class="design-toolbox-tabs" role="tablist" aria-label="Toolbox categories"></div>' +
      '<input type="search" aria-label="Search toolbox" placeholder="Search controls">' +
      '<div class="design-toolbox-list" role="tabpanel" aria-label="Common controls"></div>';
    this.root.querySelector('input').value = this.view.search;
    this.root.querySelector('input').oninput = event => {
      this.view.search = event.target.value;
      this.render();
    };
    this.root.querySelector('[data-toolbox-pointer]').onclick = () => {
      this.view.surface?.drawing?.choose(null);
      this.view.preview = false;
      this.view.resizeArtboard();
      this.view.scroller.focus();
      this.view.accessibility?.announce('Pointer selection tool');
    };
    this.keyHandler = event => this.keydown(event);
    this.root.addEventListener('keydown', this.keyHandler);
    this.renderTabs();
  }

  updateAnalysis(analysis) {
    const changed = this.catalog.updateAnalysis(analysis);
    if (changed && this.root) this.render();
    return changed;
  }

  renderTabs() {
    if (!this.root) return;
    const tabs = this.root.querySelector('.design-toolbox-tabs');
    tabs.replaceChildren();
    for (const tab of this.catalog.tabs()) {
      const button = this.root.ownerDocument.createElement('button');
      button.type = 'button';
      button.textContent = tab.label;
      button.dataset.toolboxTab = tab.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.id === this.tab));
      button.tabIndex = tab.id === this.tab ? 0 : -1;
      button.onclick = () => this.selectTab(tab.id);
      tabs.append(button);
    }
  }

  selectTab(id) {
    if (!this.catalog.tabs().some(tab => tab.id === id)) throw new TypeError('Unknown toolbox tab');
    this.tab = id;
    this.render();
    this.root.querySelector(`[data-toolbox-tab="${id}"]`)?.focus();
  }

  render() {
    this.install();
    if (!this.root || this.disposed) return;
    this.renderTabs();
    const list = this.root.querySelector('.design-toolbox-list');
    list.setAttribute('aria-label', this.catalog.tabs().find(tab => tab.id === this.tab).label + ' controls');
    const groups = new Map();
    for (const control of this.catalog.items(this.tab, this.view.search)) {
      if (!groups.has(control.category)) groups.set(control.category, []);
      groups.get(control.category).push(control);
    }
    list.innerHTML = [...groups].map(([category, controls]) => {
      const open = this.view.search || this.groups.get(category) !== false;
      return `<details class="design-toolbox-category" ${open ? 'open' : ''} data-category="${escape(category)}">` +
        `<summary><span>${escape(category)}</span></summary>` + controls.map(control =>
          `<button type="button" draggable="true" data-control="${escape(control.type)}"` +
          ` aria-label="Insert ${escape(control.name)}" title="${escape(control.type)}. ` +
          'Click to insert; Alt+click to draw on surface; drag for placement">' +
          `<span aria-hidden="true">${icon(categoryIcons[category] ?? 'boxes')}</span>` +
          `<span>${escape(control.name)}</span></button>`).join('') + '</details>';
    }).join('');
    if (!groups.size) {
      const empty = list.ownerDocument.createElement('p');
      empty.setAttribute('role', 'status');
      empty.textContent = this.tab === 'project' ? 'No constructible project UserControls in the last successful analysis.' :
        this.tab === 'recent' ? 'Inserted controls appear here.' : 'No matching controls.';
      list.append(empty);
    }
    for (const group of list.querySelectorAll('details')) {
      group.ontoggle = () => { if (!this.view.search) this.groups.set(group.dataset.category, group.open); };
    }
    for (const button of list.querySelectorAll('[data-control]')) {
      // The second click in a double-click does not create a second transaction.
      button.onclick = event => { if (event.detail <= 1) this.view.safe(() => this.insert(button.dataset.control)); };
      button.ondragstart = event => {
        event.dataTransfer.setData('application/x-sharpforge-control', button.dataset.control);
        event.dataTransfer.effectAllowed = 'copy';
      };
    }
  }

  insert(type, point) {
    const accepts = id => !this.view.outline?.isLocked(id) && this.view.outline?.isVisible(id) !== false;
    const parent = this.insertionParent();
    const properties = {};
    if (point && parent.type.endsWith('.Canvas')) {
      const bounds = this.view.host.elements.get(parent.id)?.getBoundingClientRect();
      if (!bounds) throw new Error('The insertion container has no rendered bounds');
      properties.Left = Math.round((point.x - bounds.left) / this.view.zoom / this.view.snap) * this.view.snap;
      properties.Top = Math.round((point.y - bounds.top) / this.view.zoom / this.view.snap) * this.view.snap;
    }
    const id = insertToolboxControl(this.view.document, this.catalog, type, {properties, accepts, parentId: parent.id});
    this.render();
    this.view.accessibility?.announce('Inserted ' + this.catalog.control(type).name);
    return id;
  }

  insertionParent(selected = this.view.document.selection[0]) {
    return toolboxInsertionParent(this.view.document, {
      selected, accepts: id => !this.view.outline?.isLocked(id) && this.view.outline?.isVisible(id) !== false
    });
  }

  createDrawn(type, {parentId = this.insertionParent().id, bounds, index, properties = {}} = {}) {
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0) throw new TypeError('Drawn control bounds must be positive and finite');
    const accepts = id => !this.view.outline?.isLocked(id) && this.view.outline?.isVisible(id) !== false;
    const parent = this.view.document.node(parentId);
    if (!parent || !accepts(parentId)) throw new TypeError('The drawing target is missing, hidden or locked');
    const candidate = new DesignDocument(this.view.document.snapshot());
    const geometry = {Width: bounds.width, Height: bounds.height, ...properties};
    if (parent.type.endsWith('.Canvas')) Object.assign(geometry, {Left: bounds.x, Top: bounds.y});
    const id = insertToolboxControl(candidate, this.catalog, type, {parentId, properties: geometry, recordRecent: false});
    if (index !== undefined) {
      if (!Number.isInteger(index) || index < 0) throw new TypeError('Drawing insertion index must be nonnegative');
      candidate.move(id, parentId, Math.min(index, candidate.node(parentId).children.length - 1));
    }
    this.view.document.change('Draw ' + this.catalog.control(type).name, value => Object.assign(value, candidate.snapshot()));
    this.view.document.select(id);
    this.catalog.used(type);
    this.render();
    return id;
  }

  openInsertion() {
    this.install();
    this.view.docking.activate('designer-toolbox');
    this.root.querySelector('input').focus();
    this.view.accessibility?.announce('Insert control. Search the toolbox, then press Arrow Down to choose a control.');
  }

  keydown(event) {
    const tabs = [...this.root.querySelectorAll('[data-toolbox-tab]')];
    const tab = event.target.closest('[data-toolbox-tab]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      event.preventDefault();
      this.selectTab(tabs[next].dataset.toolboxTab);
    } else if (event.target.matches('input') && event.key === 'ArrowDown') {
      event.preventDefault();
      this.root.querySelector('[data-control]')?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.view.scroller.focus();
    }
  }

  dispose() {
    this.disposed = true;
    this.root?.removeEventListener('keydown', this.keyHandler);
    this.root = null;
  }
}
