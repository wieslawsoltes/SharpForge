import {designerPreviewDecorations, resolvedProperties, selectedResponsiveState} from '@sharpforge/designer';

function effectiveGeometryProperty(design, node, name, {resolved, state, theme}) {
  let value = Object.hasOwn(state?.overrides[node.id] ?? {}, name) ? state.overrides[node.id][name] : resolved[name];
  const reference = node.resourceReferences?.[name];
  if (reference) {
    const resource = design.resources[reference.key];
    value = resource.kind === 'theme' ? resource.variants[theme] ?? resource.variants.default : resource.value;
  }
  const sample = design.designTime?.nodes[node.id];
  if (Object.hasOwn(sample?.properties ?? {}, name)) value = sample.properties[name];
  if (Object.hasOwn(sample?.bindingValues ?? {}, name)) value = sample.bindingValues[name];
  return structuredClone(value);
}

/** A model delta is authoritative; object identity alone never authorizes incremental preview publication. */
export class DesignerPreviewProjection {
  constructor(view) {
    this.view = view;
    this.document = null;
    this.revision = -1;
    this.hostRevision = -1;
    this.environment = null;
    this.state = null;
    this.decorations = new Map();
  }

  update(event = {}) {
    const view = this.view;
    view.resourceGallery.render();
    if (view.resourceDocument) {
      this.dispose();
      return false;
    }
    if (this.tryProperties(event)) return true;
    const scene = view.buildPreviewScene();
    view.host.load(scene);
    view.host.flush();
    this.decorations.clear();
    for (const decoration of designerPreviewDecorations(scene)) {
      if (!this.decorations.has(decoration.id)) this.decorations.set(decoration.id, []);
      this.decorations.get(decoration.id).push(decoration);
    }
    this.decorate(this.decorations.keys());
    view.resizeArtboard();
    this.environment = {...view.surface.preview.value};
    this.state = selectedResponsiveState(view.document.value,
      (this.environment.width ?? view.document.value.width) / this.environment.scale, this.environment.state);
    this.remember();
    return false;
  }

  sameEnvironment() {
    const current = this.view.surface.preview.value;
    return this.environment && Object.keys(this.environment).every(key => this.environment[key] === current[key]);
  }

  tryProperties(event) {
    const view = this.view;
    if (event.changes?.kind !== 'properties' || this.document !== view.document || this.revision + 1 !== view.document.revision
      || this.hostRevision !== view.host.sceneRevision || !this.sameEnvironment() || !view.host.tryPatchProperties) return false;
    const design = view.document.value;
    const theme = this.environment.contrast === 'high' ? 'highContrast' : this.environment.theme;
    const patches = [];
    for (const change of event.changes.nodes) {
      const node = view.document.node(change.id);
      if (!node) return false;
      const resolved = resolvedProperties(design, node).properties;
      const properties = {};
      const context = {resolved, state: this.state, theme};
      for (const name of change.properties) {
        properties[name] = effectiveGeometryProperty(design, node, name, context);
      }
      patches.push({id: change.id, properties});
    }
    if (!view.host.tryPatchProperties(patches)) return false;
    view.host.flush();
    this.decorate(patches.map(patch => patch.id));
    view.drawAdorners();
    this.remember();
    return true;
  }

  decorate(ids) {
    for (const id of ids) {
      const element = this.view.host.elements.get(id);
      if (!element) continue;
      for (const decoration of this.decorations.get(id) ?? []) element.style[decoration.property] = decoration.value;
    }
  }

  remember() {
    this.document = this.view.document;
    this.revision = this.document.revision;
    this.hostRevision = this.view.host.sceneRevision;
  }

  dispose() {
    this.document = null;
    this.environment = null;
    this.state = null;
    this.decorations.clear();
  }
}
