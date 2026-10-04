import { inverseMatrix, transformPoint } from '../layout/render-properties.js';

function inside(point, bounds) {
  return point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
}

/** Hit testing consumes the same transforms/clips as drawing, including transparent versus unset panel backgrounds. */
export class HitTestTree {
  constructor() { this.entries = new Map(); this.roots = []; }
  update(layout, roots) {
    this.entries = layout instanceof Map ? layout : new Map(layout.nodes.map(node => [node.id, node]));
    this.roots = [...roots];
  }
  hitTest(point, { all = false, includeDisabled = false } = {}) {
    const results = [];
    const visit = id => {
      const entry = this.entries.get(id);
      if (!entry) return false;
      const properties = entry.node?.properties ?? {};
      if (properties.Visibility === 1 || properties.Visible === false || properties.IsHitTestVisible === false || properties.IsHitTestVisible === 0
        || !includeDisabled && (properties.IsEnabled === false || properties.IsEnabled === 0)) return false;
      for (const clip of entry.clips ?? []) {
        const inverse = inverseMatrix(clip.transform);
        if (!inverse || !inside(transformPoint(inverse, point), clip.rect)) return false;
      }
      const children = entry.children.map((child, index) => ({ id: child, index,
        z: this.entries.get(child)?.node?.properties?.ZIndex ?? 0 })).sort((left, right) => right.z - left.z || right.index - left.index);
      for (const child of children) if (visit(child.id) && !all) return true;
      const inverse = inverseMatrix(entry.worldTransform);
      if (!inverse) return false;
      const local = transformPoint(inverse, point);
      if (!inside(local, { x: 0, y: 0, ...entry.renderSize })) return false;
      const type = entry.node?.type?.split('.').at(-1);
      const panel = ['Panel', 'Canvas', 'Grid', 'StackPanel', 'RelativePanel', 'WrapGrid', 'VariableSizedWrapGrid'].includes(type);
      if (panel && properties.Background == null) return false;
      results.push(id);
      return true;
    };
    for (let index = this.roots.length - 1; index >= 0; index--) if (visit(this.roots[index]) && !all) break;
    return all ? results : results[0] ?? null;
  }
}
