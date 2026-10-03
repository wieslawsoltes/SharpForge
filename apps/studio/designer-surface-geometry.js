import {affineMatrix, boundsOfPoints, designRectangle, DesignSpatialIndex, geometryInvariant, identityMatrix,
  inverseMatrix, multiplyMatrix, rectanglePoints, transformPoint, transformRectangle} from '@sharpforge/designer';
import {DesignerTextBaselines} from './designer-surface-baseline.js';

function cssMatrix(text) {
  if (!text || text === 'none') return identityMatrix();
  const match = /^(matrix|matrix3d)\(([^)]+)\)$/.exec(text);
  geometryInvariant(match, 'SFD_SURFACE_TRANSFORM', 'The browser did not expose a resolved affine transform.');
  const values = match[2].split(',').map(Number);
  if (match[1] === 'matrix') return affineMatrix(values);
  geometryInvariant(values.length === 16 && [2, 3, 6, 7, 8, 9, 11, 14].every(index => values[index] === 0)
    && values[10] === 1 && values[15] === 1, 'SFD_SURFACE_PERSPECTIVE',
  'Perspective transforms cannot be edited in a two-dimensional designer.');
  return affineMatrix([values[0], values[1], values[4], values[5], values[12], values[13]]);
}

function measuredSize(element, style, axis) {
  const dimension = Number.parseFloat(style[axis]);
  if (!Number.isFinite(dimension)) return axis === 'width' ? element.offsetWidth : element.offsetHeight;
  if (style.boxSizing === 'border-box') return dimension;
  const sides = axis === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom'];
  return dimension + sides.reduce((sum, side) => sum + (Number.parseFloat(style[`padding${side}`]) || 0)
    + (Number.parseFloat(style[`border${side}Width`]) || 0), 0);
}

/** One read phase creates a transform cache. Gesture frames use the cache and perform writes only. */
export class DesignerSurfaceGeometry {
  constructor(view) {
    this.view = view;
    this.entries = new Map();
    this.index = new DesignSpatialIndex({maxItems: 20000});
    this.valid = false;
    this.document = null;
    this.revision = -1;
    this.pending = null;
    this.frame = null;
    this.ensureEntry = null;
    this.baselines = new DesignerTextBaselines(view.stage.ownerDocument);
  }

  invalidate() {
    this.valid = false;
    if (this.frame !== null) this.view.stage.ownerDocument.defaultView.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }

  refresh({all = false} = {}) {
    const view = this.view;
    if (this.valid && this.document === view.document && this.revision === view.document.revision) {
      for (const id of view.document.selection.slice(0, 32)) this.ensureEntry(id);
      if (all && this.pending) this.measurePending(Infinity);
      return;
    }
    this.invalidate();
    this.entries.clear();
    this.index.clear();
    const window = view.stage.ownerDocument.defaultView;
    const matrices = new WeakMap();
    const styles = new WeakMap();
    const styleOf = element => {
      if (!styles.has(element)) styles.set(element, window.getComputedStyle(element));
      return styles.get(element);
    };
    const linear = (element, depth = 0) => {
      if (matrices.has(element)) return matrices.get(element);
      geometryInvariant(depth < 128, 'SFD_SURFACE_DEPTH', 'DOM transform depth exceeds 128.');
      const own = cssMatrix(styleOf(element).transform);
      const parent = element.parentElement ? linear(element.parentElement, depth + 1) : identityMatrix();
      const matrix = multiplyMatrix(parent, own);
      matrix[4] = 0;
      matrix[5] = 0;
      matrices.set(element, matrix);
      return matrix;
    };
    const measure = element => {
      const style = styleOf(element);
      const width = measuredSize(element, style, 'width');
      const height = measuredSize(element, style, 'height');
      const rectangle = element.getBoundingClientRect();
      const matrix = [...linear(element)];
      const offsets = boundsOfPoints(rectanglePoints({Width: width, Height: height}, matrix));
      matrix[4] = rectangle.left - offsets.Left;
      matrix[5] = rectangle.top - offsets.Top;
      return {matrix, width, height, style};
    };
    this.stage = measure(view.stage);
    this.stageInverse = inverseMatrix(this.stage.matrix);
    const nodes = new Map(view.document.value.nodes.map(node => [node.id, node]));
    this.ensureEntry = (id, {force = false} = {}) => {
      if (force) this.entries.delete(id);
      if (this.entries.has(id)) return this.entries.get(id);
      const node = nodes.get(id);
      if (!node) return null;
      const element = view.host.elements.get(node.id);
      if (!element || !element.isConnected) return null;
      if (force) styles.delete(element);
      const parentId = view.document.parent(node.id)?.id;
      const parent = parentId ? this.ensureEntry(parentId, {force}) : null;
      const measured = measure(element);
      const stageMatrix = multiplyMatrix(this.stageInverse, measured.matrix);
      const bounds = transformRectangle({Width: measured.width, Height: measured.height}, stageMatrix);
      const entry = {id: node.id, node, element, ...measured, stageMatrix, bounds,
        parentMatrix: parent?.matrix ?? this.stage.matrix};
      entry.baseline = this.baselines.measure(entry);
      this.index.set(node.id, bounds);
      const position = transformPoint(inverseMatrix(entry.parentMatrix), transformPoint(entry.matrix, {x: 0, y: 0}));
      const parentIsCanvas = parent?.node.type.endsWith('.Canvas');
      entry.rectangle = designRectangle({Left: parentIsCanvas ? entry.node.properties.Left ?? position.x : position.x,
        Top: parentIsCanvas ? entry.node.properties.Top ?? position.y : position.y,
        Width: entry.width, Height: entry.height});
      this.entries.set(id, entry);
      return entry;
    };
    this.document = view.document;
    this.revision = view.document.revision;
    this.valid = true;
    this.pending = {nodes: [...nodes.keys()], offset: 0};
    if (all || nodes.size <= 128) this.measurePending(Infinity);
    else {
      for (const id of view.document.selection.slice(0, 32)) this.ensureEntry(id);
      this.scheduleMeasurements();
    }
  }

  measurePending(budgetMs) {
    const clock = this.view.stage.ownerDocument.defaultView.performance;
    const start = clock.now();
    while (this.pending && this.pending.offset < this.pending.nodes.length) {
      this.ensureEntry(this.pending.nodes[this.pending.offset++]);
      if (clock.now() - start >= budgetMs) break;
    }
    if (this.pending?.offset === this.pending?.nodes.length) this.pending = null;
  }

  scheduleMeasurements() {
    if (!this.pending || this.frame !== null) return;
    this.frame = this.view.stage.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.frame = null;
      this.view.safe(() => this.measurePending(4));
      this.view.surface?.drawAdorners();
      this.scheduleMeasurements();
    });
  }

  get(id) {
    this.refresh();
    return this.entries.get(id) ?? this.ensureEntry(id);
  }

  /** Refresh only edited controls and their ancestor path after a temporary layout write. */
  remeasure(ids) {
    this.refresh();
    return ids.map(id => this.ensureEntry(id, {force: true}));
  }

  rect(id) {
    const entry = this.get(id);
    geometryInvariant(entry, 'SFD_SURFACE_MEASURE', 'Control has no rendered layout bounds.');
    return {...entry.rectangle};
  }

  localPoint(id, client) {
    const entry = this.get(id);
    return transformPoint(inverseMatrix(entry?.matrix ?? this.stage.matrix), client);
  }

  stagePoint(client) {
    this.refresh();
    return transformPoint(this.stageInverse, client);
  }

  visibleBounds() {
    const box = this.view.scroller.getBoundingClientRect();
    return transformRectangle({Left: box.left, Top: box.top, Width: box.width, Height: box.height}, this.stageInverse);
  }

  selectionBounds() {
    this.refresh();
    const points = this.view.document.selection.flatMap(id => {
      const entry = this.entries.get(id);
      return entry ? rectanglePoints(entry.bounds) : [];
    });
    return points.length ? boundsOfPoints(points) : {Left: 0, Top: 0, Width: 1, Height: 1};
  }

  dispose() {
    this.invalidate();
    this.baselines.dispose();
    this.entries.clear();
    this.index.clear();
    this.ensureEntry = null;
  }
}
