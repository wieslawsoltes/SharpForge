import {
  DesignDocument, DesignerToolboxCatalog, insertToolboxControl, toolboxInsertionParent
} from '../../packages/designer/src/index.js';
import {icon} from './icons.js';
import {escapeHtml as escape} from '../../packages/editor/src/index.js';
import {DesignerToolboxTabs} from './designer-toolbox-tabs.js';
import {decorateDesignerButton} from './designer-command-buttons.js';

const categoryIcons = {Layout: 'layout', Input: 'file', Drawing: 'layers', Controls: 'boxes', Project: 'solution'};

function controlButton(control, readOnly) {
  const label = (control.previewOnly ? 'Insert preview of ' : 'Insert ') + control.name;
  const usage = readOnly ? 'This source preview is read only. Open its source to make changes.' :
    (control.previewOnly ? 'Preview only; this project type cannot execute on the current runtime. ' : '') +
    'Click to insert; Alt+click to draw on surface; drag for placement';
  return `<button type="button" draggable="${!readOnly}" data-control="${escape(control.type)}"` +
    `${readOnly ? ' disabled' : ''} data-toolbox-preview="${!!control.previewOnly}"` +
    ` aria-label="${escape(label)}" title="${escape(control.type + '. ' + usage)}">` +
    `<span aria-hidden="true">${icon(categoryIcons[control.category] ?? 'boxes')}</span>` +
    `<span>${escape(control.name)}</span>` + (control.previewOnly ? '<small class="design-toolbox-preview-badge">Preview only</small>' : '') +
    '</button>';
}

/** Searchable tabs preserve successful catalogs and distinctly label source-proven read-only previews. */
export class DesignerToolbox {
  constructor(view, {catalog = new DesignerToolboxCatalog()} = {}) {
    this.view = view;
    this.catalog = catalog;
    this.tab = 'common';
    this.groups = new Map();
    this.root = null;
    this.disposed = false;
    this.tabsController = new DesignerToolboxTabs(this);
  }

  install() {
    if (this.root || this.disposed) return;
    this.tabsController.load();
    this.root = this.view.panel('designer-toolbox');
    this.root.classList.add('design-side');
    this.root.innerHTML = '<div class="panel-tools"><b>Toolbox</b>' +
      '<button type="button" data-toolbox-pointer aria-pressed="true">Pointer</button></div>' +
      '<div class="design-toolbox-tabs" role="tablist" aria-label="Toolbox categories"></div>' +
      '<div class="design-toolbox-tab-actions"><button type="button" data-toolbox-tab-add>New tab</button>' +
      '<button type="button" data-toolbox-tab-remove disabled>Remove tab</button></div>' +
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
    this.root.querySelector('[data-toolbox-tab-add]').onclick = () => this.view.safe(() => this.tabsController.open());
    this.root.querySelector('[data-toolbox-tab-remove]').onclick = () => this.view.safe(() => this.tabsController.remove());
    decorateDesignerButton(this.root.querySelector('[data-toolbox-tab-add]'), {icon: 'file-plus', label: 'New tab'});
    decorateDesignerButton(this.root.querySelector('[data-toolbox-tab-remove]'), {icon: 'clear', label: 'Remove tab'});
    this.keyHandler = event => this.keydown(event);
    this.root.addEventListener('keydown', this.keyHandler);
    this.renderTabs();
  }

  updateAnalysis(analysis) {
    const changed = this.catalog.updateAnalysis(analysis);
    if (changed && this.root) this.render();
    return changed;
  }

  updatePreviewAnalysis(analysis) {
    const changed = this.catalog.updatePreviewAnalysis(analysis);
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
    this.root.querySelector('[data-toolbox-tab-remove]').disabled = !this.catalog.customTabs.has(this.tab);
  }

  selectTab(id) {
    if (!this.catalog.tabs().some(tab => tab.id === id)) throw new TypeError('Unknown toolbox tab');
    this.tab = id;
    this.render();
    this.root?.querySelector(`[data-toolbox-tab="${id}"]`)?.focus();
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
        `<summary><span>${escape(category)}</span></summary>` + controls.map(control => controlButton(control, this.view.document.readOnly))
          .join('') + '</details>';
    }).join('');
    if (!groups.size) {
      const empty = list.ownerDocument.createElement('p');
      empty.setAttribute('role', 'status');
      empty.textContent = this.tab === 'project' ? 'No compiled controls or qualified project previews are available.' :
        this.tab === 'recent' ? 'Inserted controls appear here.' : 'No matching controls.';
      list.append(empty);
    }
    for (const group of list.querySelectorAll('details')) {
      group.ontoggle = () => { if (!this.view.search) this.groups.set(group.dataset.category, group.open); };
    }
    for (const button of list.querySelectorAll('[data-control]')) {
      // The second click in a double-click does not create a second transaction.
      button.onclick = event => {
        if (event.detail > 1) return;
        const type = button.dataset.control;
        this.view.safe(() => {
          this.insert(type);
          // Rendering replaces the activated button; keep keyboard and AT focus inside the toolbox.
          if (event.detail === 0) this.focusControl(type);
        });
      };
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
    const id = insertToolboxControl(this.view.document, this.catalog, type, {
      properties, accepts, parentId: parent.id, naming: this.view.naming ?? this.view.designerOptions?.value.naming ?? 'type'
    });
    this.render();
    this.view.accessibility?.announce('Inserted ' + this.catalog.control(type).name);
    return id;
  }

  focusControl(type) {
    if (!this.root) return;
    const replacement = [...this.root.querySelectorAll('[data-control]')].find(button => button.dataset.control === type);
    (replacement ?? this.root.querySelector('input'))?.focus();
  }

  insertionParent(selected = this.view.document.selection[0]) {
    return toolboxInsertionParent(this.view.document, {
      selected, accepts: id => !this.view.outline?.isLocked(id) && this.view.outline?.isVisible(id) !== false
    });
  }

  createDrawn(type, {parentId = this.insertionParent().id, bounds, index, properties = {}} = {}) {
    if (this.view.document.readOnly) throw new TypeError('This source preview is read only. Open its source to make changes.');
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0) throw new TypeError('Drawn control bounds must be positive and finite');
    const accepts = id => !this.view.outline?.isLocked(id) && this.view.outline?.isVisible(id) !== false;
    const parent = this.view.document.node(parentId);
    if (!parent || !accepts(parentId)) throw new TypeError('The drawing target is missing, hidden or locked');
    const candidate = new DesignDocument(this.view.document.snapshot());
    const geometry = {Width: bounds.width, Height: bounds.height, ...properties};
    if (parent.type.endsWith('.Canvas')) Object.assign(geometry, {Left: bounds.x, Top: bounds.y});
    const id = insertToolboxControl(candidate, this.catalog, type, {
      parentId, properties: geometry, recordRecent: false, naming: this.view.naming ?? this.view.designerOptions?.value.naming ?? 'type'
    });
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
    this.tabsController.dispose();
    this.root = null;
  }
}
