import {affineMatrix, boundsOfPoints, designRectangle, DesignSpatialIndex, geometryInvariant, identityMatrix,
  inverseMatrix, multiplyMatrix, rectanglePoints, transformPoint, transformRectangle} from '@sharpforge/designer';

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
  }

  invalidate() {
    this.valid = false;
  }

  refresh() {
    const view = this.view;
    if (this.valid && this.document === view.document && this.revision === view.document.revision) return;
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
    for (const node of view.document.value.nodes) {
      const element = view.host.elements.get(node.id);
      if (!element || !element.isConnected) continue;
      const measured = measure(element);
      const stageMatrix = multiplyMatrix(this.stageInverse, measured.matrix);
      const bounds = transformRectangle({Width: measured.width, Height: measured.height}, stageMatrix);
      this.entries.set(node.id, {id: node.id, node, element, ...measured, stageMatrix, bounds});
      this.index.set(node.id, bounds);
    }
    for (const entry of this.entries.values()) {
      const parent = this.entries.get(view.document.parent(entry.id)?.id);
      entry.parentMatrix = parent?.matrix ?? this.stage.matrix;
      const position = transformPoint(inverseMatrix(entry.parentMatrix), transformPoint(entry.matrix, {x: 0, y: 0}));
      const parentIsCanvas = parent?.node.type.endsWith('.Canvas');
      entry.rectangle = designRectangle({Left: parentIsCanvas ? entry.node.properties.Left ?? position.x : position.x,
        Top: parentIsCanvas ? entry.node.properties.Top ?? position.y : position.y,
        Width: entry.width, Height: entry.height});
    }
    this.document = view.document;
    this.revision = view.document.revision;
    this.valid = true;
  }

  get(id) {
    this.refresh();
    return this.entries.get(id);
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
    this.entries.clear();
    this.index.clear();
    this.valid = false;
  }
}
