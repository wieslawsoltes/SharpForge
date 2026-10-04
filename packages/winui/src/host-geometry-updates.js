import {measureHostNodes, renderHostScene} from './host-render.js';
import {HostCanvasTranslations} from './host-canvas-translations.js';

const geometryProperties = new Set(['Left', 'Top', 'Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight',
  'Margin', 'HorizontalAlignment', 'VerticalAlignment', 'ZIndex', 'Row', 'Column', 'RowSpan', 'ColumnSpan', 'WrapRowSpan', 'WrapColumnSpan']);
const drawingTypes = new Set(['Microsoft.UI.Xaml.Shapes.Rectangle', 'Microsoft.UI.Xaml.Shapes.Ellipse', 'Microsoft.UI.Xaml.Shapes.Line']);
const absolute = properties => properties.Left !== undefined || properties.Top !== undefined;

/** Retain scene topology once per full render; property-only Canvas leaves have no sibling layout dependency. */
export class HostGeometryUpdates {
  constructor(host) {
    this.host = host;
    this.revision = 0;
    this.request = 0;
    this.full = true;
    this.parents = new Map();
    this.dirty = new Set();
    this.measurements = new Set();
    this.translations = new HostCanvasTranslations(host);
  }

  invalidate() {
    this.revision++;
    this.requestFull();
  }

  requestFull() {
    this.request++;
    this.full = true;
    this.dirty.clear();
    this.measurements.clear();
    this.translations.clear();
  }

  schedule({partial = false} = {}) {
    if (!partial) this.requestFull();
    const host = this.host;
    if (host.disposed || host.frame) return;
    const clock = host.document.defaultView;
    const render = () => {
      host.frame = 0;
      try { host.render(); }
      catch (error) { host.options.onError(error); }
    };
    host.frame = clock.requestAnimationFrame ? clock.requestAnimationFrame(render) : setTimeout(render, 16);
  }

  index() {
    this.parents.clear();
    const add = (id, parent) => {
      if (id) this.parents.set(id, this.parents.has(id) ? null : parent);
    };
    for (const node of this.host.nodes.values()) {
      add(node.templateRoot, node.id);
      add(node.properties.Content?.$ref, node.id);
      add(node.properties.Child?.$ref, node.id);
      for (const child of node.collections?.Children ?? []) add(child?.$ref, node.id);
    }
  }

  isolated(id) {
    const node = this.host.nodes.get(id);
    const parent = this.host.nodes.get(this.parents.get(id));
    if (!node || !this.host.elements.has(id) || parent?.type !== 'Microsoft.UI.Xaml.Controls.Canvas') return false;
    if (!absolute(node.properties) || node.templateRoot || node.templateOwner || drawingTypes.has(node.type)) return false;
    if (node.properties.Content?.$ref || node.properties.Child?.$ref) return false;
    return !Object.values(node.collections ?? {}).some(items => items.some(item => item?.$ref));
  }

  /** Return false before mutation when a property or node requires full scene dependency processing. */
  tryPatch(changes) {
    if (!Array.isArray(changes) || changes.length > 10000) throw new TypeError('Geometry patches require at most 10000 node records.');
    if (this.host.disposed || this.full || this.host.openFlyouts.size || this.host.pendingFlyouts.length) return false;
    const candidates = new Map();
    for (const change of changes) {
      if (!change || typeof change.id !== 'string' || !change.properties || typeof change.properties !== 'object'
        || Array.isArray(change.properties) || candidates.has(change.id) || !this.isolated(change.id)) return false;
      const previous = this.host.nodes.get(change.id).properties;
      const properties = {...previous};
      for (const [name, value] of Object.entries(change.properties)) {
        if (!geometryProperties.has(name)) return false;
        if (value === undefined) delete properties[name];
        else properties[name] = structuredClone(value);
      }
      if (!absolute(properties)) return false;
      const layoutCurrent = !this.dirty.has(change.id) || this.translations.records.has(change.id);
      const translation = layoutCurrent ? this.translations.prepare(change.id, previous, properties, change.properties) : null;
      candidates.set(change.id, {properties, translation});
    }
    for (const [id, {properties, translation}] of candidates) {
      this.host.nodes.get(id).properties = properties;
      this.translations.commit(id, translation);
      this.dirty.add(id);
      this.measurements.add(id);
    }
    if (candidates.size) {
      this.revision++;
      this.request++;
      this.host.schedule({partial: true});
    }
    return true;
  }

  /** Browser resize notifications for isolated leaves need measurement, not another full style render. */
  resized(entries) {
    if (this.host.disposed || !entries.length) return;
    const ids = entries.map(entry => entry.target.dataset?.sfId);
    if (this.full || ids.some(id => !this.isolated(id))) {
      this.host.schedule();
      return;
    }
    for (const id of ids) this.measurements.add(id);
    this.request++;
    this.host.schedule({partial: true});
  }

  render() {
    if (this.host.disposed) return;
    const request = this.request;
    if (this.full || !this.dirty.size && !this.measurements.size) {
      this.translations.clear();
      renderHostScene(this.host);
      this.index();
    } else {
      for (const id of this.dirty) {
        const node = this.host.nodes.get(id);
        if (!this.translations.render(id)) this.host.renderNode(node, this.host.elements.get(id));
        this.host.drawNode(node);
      }
      measureHostNodes(this.host, this.measurements);
    }
    if (request === this.request) {
      this.full = false;
      this.dirty.clear();
      this.measurements.clear();
    }
  }

  dispose() {
    this.parents.clear();
    this.dirty.clear();
    this.measurements.clear();
    this.translations.clear();
  }
}
