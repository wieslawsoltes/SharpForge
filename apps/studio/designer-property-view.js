import {
  createPropertyEditorRegistry, DesignerPropertyCommands, DesignerPropertyGridState, designerPropertyRows
} from '../../packages/designer/src/index.js';
import {frameworkAssignable} from '../../packages/framework/src/index.js';
import {propertyButton, propertyElement, propertyInput, propertySelect, runPropertyAction} from './designer-property-dom.js';
import {
  booleanPropertyEditor, compoundPropertyEditor, enumPropertyEditor, flagsPropertyEditor, fontPropertyEditor,
  gridLengthPropertyEditor, numericPropertyEditor, textPropertyEditor
} from './designer-property-basic.js';
import {brushPropertyEditor} from './designer-property-brush.js';
import {openDesignerBindingEditor, openDesignerTemplateBinding} from './designer-property-binding.js';
import {openDesignerCollectionEditor} from './designer-property-collection.js';
import {assetPropertyEditor} from './designer-property-assets.js';
import {propertySourceMarker} from './designer-property-markers.js';
import {renderDesignerEvents} from './designer-property-events.js';

/** The property panel owns UI state; the package commands own validation, transactions and history. */
export class DesignerPropertyController {
  constructor(view) {
    this.view = view;
    this.state = new DesignerPropertyGridState(view.designerOptions?.value ?? {});
    this.registry = createPropertyEditorRegistry({text: textPropertyEditor, boolean: booleanPropertyEditor,
      number: numericPropertyEditor, enum: enumPropertyEditor, flags: flagsPropertyEditor, font: fontPropertyEditor,
      compound: compoundPropertyEditor, gridLength: gridLengthPropertyEditor, brush: brushPropertyEditor, asset: assetPropertyEditor,
      collection: context => propertyButton(context.document, `Edit ${context.value?.length ?? 0} items…`,
        () => context.run(() => openDesignerCollectionEditor(context)))});
  }

  get modelDocument() { return this.view.resources?.scopedDocument ?? this.view.document; }

  persist() {
    if (this.view.designerOptions) this.view.designerOptions.update(this.state.snapshot());
  }

  render(panel = this.view.panel('designer-properties')) {
    if (!panel) return;
    this.panel = panel;
    const model = this.modelDocument;
    const node = model.node();
    const document = panel.ownerDocument;
    panel.replaceChildren();
    if (!node) { panel.textContent = 'Select a control'; return; }
    const header = propertyElement(document, 'div', '', 'panel-tools');
    header.append(propertyElement(document, 'b', model.selection.length === 1 ? node.properties.Name || node.type.split('.').at(-1) :
      `${model.selection.length} controls`));
    const tab = propertySelect(document, [{value: 'properties', label: 'Properties'}, {value: 'events', label: '⚡ Events'}],
      this.state.tab, 'Property panel view');
    tab.addEventListener('change', () => { this.state.tab = tab.value; this.render(); });
    header.append(tab);
    panel.append(header);
    if (this.state.tab === 'events') { renderDesignerEvents(this, panel); return; }
    const search = propertyInput(document, {value: this.state.search, label: 'Search property names and values', placeholder: 'Search name or value'});
    search.className = 'design-property-search';
    search.addEventListener('input', () => {
      const position = search.selectionStart;
      this.state.search = search.value;
      this.view.propertySearch = search.value;
      this.render();
      const next = panel.querySelector('.design-property-search');
      next.focus();
      next.setSelectionRange(position, position);
    });
    const arrange = propertySelect(document, ['category', 'name', 'source'], this.state.arrange, 'Arrange properties');
    arrange.addEventListener('change', () => this.view.safe(() => { this.state.arrange = arrange.value; this.persist(); this.render(); }));
    panel.append(search, arrange);
    this.renderReferences(panel, node);
    const sourceBindings = this.view.sourceSync?.session?.analysis?.bindings ?? {};
    const rows = designerPropertyRows(model.value, model.selection, {...this.state, sourceBindings});
    const list = propertyElement(document, 'div', '', 'design-property-list');
    const groups = new Map();
    for (const row of rows) {
      const category = this.state.arrange === 'name' ? '' : this.state.arrange === 'source' ? row.source.kind : row.category;
      let target = list;
      if (category) {
        if (!groups.has(category)) {
          const group = propertyElement(document, 'details', '', 'design-property-category');
          group.open = !!this.state.search || !this.state.isCollapsed(node.type, category);
          group.append(propertyElement(document, 'summary', category));
          group.addEventListener('toggle', () => {
            if (!this.state.search && group.isConnected) this.view.safe(() => {
              this.state.setCollapsed(node.type, category, !group.open);
              this.persist();
            });
          });
          groups.set(category, group);
          list.append(group);
        }
        target = groups.get(category);
      }
      target.append(this.renderRow(row, sourceBindings));
    }
    list.addEventListener('keydown', event => this.navigateRows(event, list));
    panel.append(list);
    if (!rows.length) list.append(propertyElement(document, 'p', 'No matching editable properties.'));
  }

  renderRow(row, sourceBindings) {
    const document = this.panel.ownerDocument;
    const root = propertyElement(document, 'div', '', 'design-property-row');
    root.dataset.propertyRow = row.name;
    root.tabIndex = 0;
    const error = propertyElement(document, 'p', '', 'design-editor-error');
    error.hidden = true;
    const model = this.modelDocument;
    const readOnly = this.view.sourceSync?.session?.analysis?.readOnly === true;
    const commands = new DesignerPropertyCommands(model, {canEdit: (id, name) => !readOnly && !sourceBindings[id]?.properties?.[name]?.dynamic});
    const source = sourceBindings[row.ids[0]]?.properties?.[row.name];
    const analysis = this.view.sourceSync?.session?.analysis;
    const context = {...row, row: root, document, modelDocument: model, view: this.view, commands,
      run: action => runPropertyAction(action, error), commit: value => commands.set(row.name, value, row.ids),
      hasSource: !!analysis?.uri, goToSource: () => this.view.openSource(analysis.uri, source?.start ?? source?.statement?.start ?? 0),
      openReference: () => openDesignerBindingEditor(context, {resource: true})};
    root.append(propertyElement(document, 'label', row.name));
    const body = propertyElement(document, 'div', '', 'design-property-editor');
    if (row.source.kind === 'template' && row.source.expression) {
      body.append(propertyButton(document, row.source.label, () => context.run(() => openDesignerTemplateBinding(context))));
    } else if (row.source.kind === 'binding' || row.source.kind === 'resource') {
      body.append(propertyButton(document, row.source.label, () => context.run(() =>
        openDesignerBindingEditor(context, {resource: row.source.kind === 'resource'}))));
    } else {
      const result = this.registry.create(context);
      if (result.editor) body.append(result.editor);
      else {
        error.textContent = result.diagnostic.message;
        error.hidden = false;
        error.setAttribute('role', 'alert');
      }
    }
    if (row.protectedSource || readOnly) {
      body.querySelectorAll('input,select,button,textarea').forEach(input => { input.disabled = true; });
      body.append(propertyElement(document, 'small', readOnly ? 'This inherited source preview is read-only.' : 'Controlled by protected C# source.'));
    }
    root.append(body, propertySourceMarker(context), error);
    return root;
  }

  renderReferences(panel, node) {
    const document = panel.ownerDocument;
    const row = propertyElement(document, 'div', '', 'design-resource-select');
    for (const [name, table] of [['style', 'styles'], ['template', 'templates']]) {
      const values = Object.entries(this.modelDocument.value[table]).filter(([, value]) => frameworkAssignable(value.targetType, node.type));
      const select = propertySelect(document, [{value: '', label: `(${name === 'style' ? 'No style' : 'Default template'})`},
        ...values.map(([key]) => ({value: key, label: key}))], node[name] ?? '', 'Applied ' + name);
      select.addEventListener('change', () => this.view.safe(() => this.modelDocument.setReference(name, select.value)));
      row.append(select);
    }
    panel.append(row);
  }

  navigateRows(event, list) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.target.matches('input,select,textarea')) return;
    const rows = [...list.querySelectorAll('[data-property-row]')].filter(row => !row.closest('details') || row.closest('details').open);
    const index = rows.indexOf(event.target.closest('[data-property-row]'));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
    if (rows[next]) { event.preventDefault(); rows[next].focus(); }
  }

  dispose() { this.panel = null; }
}
