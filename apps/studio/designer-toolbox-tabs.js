import {normalizeToolboxTabs} from '../../packages/designer/src/index.js';
import {propertyButton, propertyDialog, propertyField, propertyInput} from './designer-property-dom.js';

/** User-managed tabs share designer settings; persistence succeeds before the visible catalog changes. */
export class DesignerToolboxTabs {
  constructor(toolbox) {
    this.toolbox = toolbox;
    this.dialogs = new Set();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    const settings = this.toolbox.view.designerOptions?.value;
    if (!settings) return;
    if (settings.toolboxTabs !== undefined) this.toolbox.catalog.restoreTabs(settings.toolboxTabs);
    this.loaded = true;
  }

  save(value) {
    const normalized = normalizeToolboxTabs(value);
    this.toolbox.view.designerOptions?.update({toolboxTabs: normalized});
    this.toolbox.catalog.restoreTabs(normalized);
    if (!this.toolbox.catalog.tabs().some(tab => tab.id === this.toolbox.tab)) this.toolbox.tab = 'common';
    this.toolbox.render();
  }

  create(label, types) {
    const catalog = this.toolbox.catalog;
    const base = String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    let id = /^[a-z]/.test(base) ? base : 'tab-' + base;
    if (!id || id === 'tab-') id = 'custom-tab';
    const used = new Set(catalog.tabs().map(tab => tab.id));
    const prefix = id;
    let serial = 1;
    while (used.has(id)) id = prefix + '-' + serial++;
    if (!Array.isArray(types)) throw new TypeError('Select the controls to include in this tab');
    const controls = types.map(type => catalog.control(type).type);
    this.save({version: 1, tabs: [...catalog.snapshotTabs().tabs, {id, label, types: controls}]});
    this.toolbox.selectTab(id);
    this.toolbox.view.accessibility?.announce('Created toolbox tab ' + label);
    return id;
  }

  remove(id = this.toolbox.tab) {
    const catalog = this.toolbox.catalog;
    if (!catalog.customTabs.has(id)) throw new TypeError('Select a custom toolbox tab to remove');
    const label = catalog.customTabs.get(id).label;
    this.save({version: 1, tabs: catalog.snapshotTabs().tabs.filter(tab => tab.id !== id)});
    this.toolbox.view.accessibility?.announce('Removed toolbox tab ' + label);
  }

  open() {
    const toolbox = this.toolbox;
    const document = toolbox.root.ownerDocument;
    const modal = propertyDialog(document, 'Create toolbox tab');
    this.dialogs.add(modal);
    modal.dialog.addEventListener('close', () => this.dialogs.delete(modal), {once: true});
    const name = propertyInput(document, {label: 'Tab name', placeholder: 'My controls'});
    name.maxLength = 80;
    const controls = document.createElement('select');
    controls.multiple = true;
    controls.size = 8;
    controls.dataset.toolboxTabControls = '';
    const selected = new Set(toolbox.catalog.items(toolbox.tab, toolbox.view.search).map(control => control.type));
    const available = [...toolbox.catalog.controls.values(), ...toolbox.catalog.projectControls()];
    available.sort((left, right) => left.name.localeCompare(right.name) || left.type.localeCompare(right.type));
    for (const control of available) {
      const option = document.createElement('option');
      option.value = control.type;
      option.textContent = control.name + (control.previewOnly ? ' — Preview only' : '');
      option.selected = selected.has(control.type);
      controls.append(option);
    }
    modal.body.append(propertyField(document, 'Tab name', name), propertyField(document, 'Included controls', controls));
    const create = () => modal.run(() => {
      this.create(name.value, [...controls.selectedOptions].map(option => option.value));
      modal.close();
    });
    modal.footer.append(propertyButton(document, 'Create tab', create));
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); create(); }
    });
    name.focus();
    return modal;
  }

  dispose() {
    for (const modal of this.dialogs) modal.close(true);
    this.dialogs.clear();
  }
}
