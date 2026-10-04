import {
  DesignerAuthoringError, DesignerStyleCommands, DesignerTemplateScope, designScene, designerPropertySchema, designerResourceEntries,
  formatDesignerProperty, projectDesignerAuthoringScene, projectDesignerState, renameDesignerResource,
  createDesignerSampleItems, setDesignerSampleData
} from '../../packages/designer/src/index.js';
import {
  parseDesignerPropertyText, propertyButton, propertyElement, propertyField, propertyInput, propertySelect, runPropertyAction
} from './designer-property-dom.js';
import {designerResourceLabel, renderDesignerResourceValue} from './designer-resource-values.js';
import {isDesignerResourceDocument} from './designer-resource-context.js';
import {DesignerInstancePreviewController} from './designer-resource-preview.js';
import {
  openCreateDesignerBrush, openCreateDesignerStyle, openCreateDesignerTemplate, openDesignerResourceName
} from './designer-resource-dialogs.js';
import {renderDesignerStates} from './designer-resource-states.js';
import {DesignerStatePlayback} from './designer-resource-playback.js';

/** Resources compose transactional package commands with explicit template-scope entry/exit. */
export class DesignerResourceController {
  constructor(view, {createScene = design => view.buildPreviewScene?.() ?? projectDesignerAuthoringScene(design, designScene(design), {
    resolveAsset: uri => view.assetPreviews?.resolve(uri)
  })} = {}) {
    this.view = view;
    this.selectedKey = 'Accent';
    this.search = '';
    this.scope = null;
    this.previewOpen = false;
    this.previewContext = null;
    this.resourceThemes = new Map();
    this.createScene = createScene;
    this.playback = new DesignerStatePlayback(view);
    this.previews = new DesignerInstancePreviewController({onError: error => view.error(error)});
  }

  get scopedDocument() { return this.scope?.document ?? null; }

  render(panel = this.view.panel('designer-styles')) {
    if (!panel) return;
    this.panel = panel;
    this.playback.stop();
    this.previews.dispose();
    this.previewContext = null;
    panel.replaceChildren();
    const document = panel.ownerDocument;
    const header = propertyElement(document, 'div', '', 'panel-tools');
    header.append(propertyElement(document, 'b', 'Resources'),
      propertyButton(document, 'Style…', () => this.view.safe(() => openCreateDesignerStyle(this))),
      propertyButton(document, 'Template…', () => this.view.safe(() => openCreateDesignerTemplate(this))),
      propertyButton(document, 'Brush…', () => this.view.safe(() => openCreateDesignerBrush(this))));
    panel.append(header);
    if (this.scope) {
      panel.append(propertyElement(document, 'p', 'Editing template ' + this.scope.key),
        propertyButton(document, 'Apply template and return', () => this.view.safe(() => this.leaveTemplate(true))),
        propertyButton(document, 'Cancel template edits', () => this.view.safe(() => this.leaveTemplate(false))));
      return;
    }
    const search = propertyInput(document, {value: this.search, label: 'Search resources', placeholder: 'Search resources'});
    search.addEventListener('input', () => {
      const start = search.selectionStart;
      this.search = search.value;
      this.render();
      const next = panel.querySelector('input');
      next.focus();
      next.setSelectionRange(start, start);
    });
    panel.append(search);
    const entries = designerResourceEntries(this.view.document.value)
      .filter(item => (item.key + ' ' + designerResourceLabel(item)).toLowerCase().includes(this.search.toLowerCase()));
    for (const key of this.resourceThemes.keys()) if (!this.view.document.value.resources?.[key]) this.resourceThemes.delete(key);
    const picker = propertySelect(document, entries.map(item => ({value: item.key, label: `${item.key} · ${designerResourceLabel(item)}`})),
      entries.some(item => item.key === this.selectedKey) ? this.selectedKey : entries[0]?.key, 'Resource');
    this.selectedKey = picker.value;
    picker.addEventListener('change', () => { this.selectedKey = picker.value; this.render(); });
    panel.append(picker);
    const selected = entries.find(item => item.key === this.selectedKey);
    if (selected) this.renderResource(panel, selected);
    if (!isDesignerResourceDocument(this.view)) this.renderSampleData(panel);
  }

  renderResource(parent, selected) {
    const document = parent.ownerDocument;
    const model = this.view.document;
    const actions = propertyElement(document, 'div', '', 'design-resource-actions');
    actions.append(propertyButton(document, 'Rename…', () => openDesignerResourceName(this, 'Rename resource', selected.key, key => {
      renameDesignerResource(model, selected.key, key);
      this.selectedKey = key;
      this.render();
    })));
    if (['style', 'template'].includes(selected.kind) && !isDesignerResourceDocument(this.view)) {
      actions.append(propertyButton(document, 'Apply to selection', () => this.view.safe(() => model.setReference(selected.kind, selected.key))));
    }
    if (selected.kind === 'style') {
      actions.append(propertyButton(document, 'Edit a copy…', () => openDesignerResourceName(this, 'Copy style', selected.key + 'Copy', key => {
        new DesignerStyleCommands(model).editCopy(selected.key, key, {ids: isDesignerResourceDocument(this.view) ? [] : model.selection});
        this.selectedKey = key;
        this.render();
      })));
    }
    if (selected.kind === 'template') actions.append(propertyButton(document, 'Edit template', () => this.view.safe(() => this.enterTemplate(selected.key))));
    parent.append(actions);
    if (selected.kind === 'style') this.renderSetters(parent, selected);
    else if (selected.kind === 'template') renderDesignerStates(this, parent, {template: selected.key});
    else renderDesignerResourceValue(this, parent, selected);
    if (['style', 'template'].includes(selected.kind)) {
      const previews = propertyElement(document, 'details', '', 'design-preview-strip');
      previews.open = this.previewOpen;
      previews.append(propertyElement(document, 'summary', 'Preview states and themes'));
      const body = propertyElement(document, 'div');
      previews.append(body);
      let rendered = false;
      const render = () => {
        if (previews.open && !rendered) {
          rendered = true;
          this.previewContext = {body, model, resourceKey: selected.key, kind: selected.kind};
          this.view.safe(() => this.refreshPreviews());
        }
        this.previewOpen = previews.open;
      };
      previews.addEventListener('toggle', render);
      parent.append(previews);
      render();
    }
    const node = model.node();
    if (node && selected.kind !== 'template' && !isDesignerResourceDocument(this.view)) renderDesignerStates(this, parent, {nodeId: node.id});
  }

  renderSetters(parent, selected) {
    const document = parent.ownerDocument;
    const commands = new DesignerStyleCommands(this.view.document);
    const schema = designerPropertySchema(selected.value.targetType);
    parent.append(propertyElement(document, 'p', 'Target: ' + selected.value.targetType));
    for (const [property, value] of Object.entries(selected.value.setters)) {
      const error = propertyElement(document, 'p', '', 'design-editor-error');
      error.hidden = true;
      const input = propertyInput(document, {value: formatDesignerProperty(value), label: property});
      input.addEventListener('change', () => runPropertyAction(() => commands.setSetter(selected.key, property,
        parseDesignerPropertyText(input.value, schema[property].type)), error));
      const row = propertyElement(document, 'div', '', 'design-style-setter');
      row.append(propertyField(document, property, input), propertyButton(document, 'Remove', () => this.view.safe(() =>
        commands.setSetter(selected.key, property, undefined))), error);
      parent.append(row);
    }
    const properties = Object.entries(schema).filter(([name, value]) => !value.readOnly && !value.isStatic && !value.attached &&
      !['Name', 'Template', 'Style', 'Child'].includes(name));
    const property = propertySelect(document, properties.map(([name]) => name), properties[0]?.[0], 'New setter property');
    const value = propertyInput(document, {value: '', label: 'New setter value'});
    parent.append(property, value, propertyButton(document, 'Add setter', () => this.view.safe(() => commands.setSetter(selected.key,
      property.value, parseDesignerPropertyText(value.value, schema[property.value].type)))));
  }

  refreshPreviews() {
    const context = this.previewContext;
    if (!context?.body.isConnected) return;
    this.previews.render(context.body, context.model.value, {resourceKey: context.resourceKey, kind: context.kind,
      resolveAsset: uri => this.view.assetPreviews?.resolve(uri)});
  }

  renderSampleData(parent) {
    const model = this.view.document;
    const node = model.node();
    if (!node || !designerPropertySchema(node.type).Items) return;
    const document = parent.ownerDocument;
    const details = propertyElement(document, 'details');
    details.append(propertyElement(document, 'summary', 'Design-time sample items'));
    const count = propertyInput(document, {type: 'number', value: model.value.designTime?.nodes[node.id]?.items?.length ?? 5,
      label: 'Sample item count'});
    count.min = 0;
    count.max = 1000;
    details.append(count, propertyButton(document, 'Set sample items', () => this.view.safe(() =>
      setDesignerSampleData(model, node.id, {items: createDesignerSampleItems(Number(count.value))}))),
    propertyButton(document, 'Clear samples', () => this.view.safe(() => setDesignerSampleData(model, node.id, null))));
    parent.append(details);
  }

  enterTemplate(key) {
    if (this.scope) throw new Error('Apply or cancel the current template scope first.');
    this.view.cancelSurfaceEdits?.();
    this.scope = new DesignerTemplateScope(this.view.document, key);
    this.view.enterTemplateScope?.(this.scope);
    this.render();
    this.view.renderProperties();
    this.view.chrome?.renderSelection();
    return this.scope;
  }

  leaveTemplate(commit = true) {
    if (!this.scope) return;
    this.view.cancelSurfaceEdits?.();
    const scope = this.scope;
    if (commit) scope.commit();
    else scope.cancel();
    this.scope = null;
    this.view.leaveTemplateScope?.(scope);
    scope.document.dispose();
    this.view.update({kind: 'template-scope'});
  }

  breadcrumbContext() {
    if (!this.scope) return null;
    return {label: 'TEMPLATE', count: this.scope.document.selection.length, crumbs: [
      {id: 'owner', label: this.scope.ownerDocument.value.name, select: () => this.view.safe(() => this.leaveTemplate(true))},
      {id: this.scope.key, label: this.scope.key, select: () => this.scope.document.select(this.scope.document.value.root)}
    ]};
  }

  stateScene(scene, target, activeStates) {
    const design = this.view.document.value;
    const owner = target.template ? design.templates[target.template] : this.view.document.node(target.nodeId);
    if (!owner) throw new DesignerAuthoringError('SFD1853', 'Visual-state owner was not found.');
    const prefixes = target.template ? design.nodes.filter(node => node.template === target.template).map(node => node.id + '::') : [''];
    if (!prefixes.length) throw new DesignerAuthoringError('SFD1853', 'Apply this template to an instance before previewing it on the surface.');
    return projectDesignerState(scene, owner.states, activeStates, {prefixes});
  }

  previewState(target, activeStates) {
    const base = this.createScene(this.view.document.value);
    const scene = this.stateScene(base, target, activeStates);
    this.playback.show(base, scene);
    return scene;
  }

  previewTransition(target, group, {from = '', to = '', duration = 150}) {
    const base = this.createScene(this.view.document.value);
    this.playback.play(base, this.stateScene(base, target, {[group]: from}), this.stateScene(base, target, {[group]: to}), {duration});
  }

  dispose() {
    this.playback.dispose();
    this.previews.dispose();
    this.scope?.cancel();
    this.scope?.document.dispose();
    this.scope = null;
    this.previewContext = null;
    this.resourceThemes.clear();
  }
}
