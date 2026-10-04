import {computeEffectiveViewports} from './effective-viewport.js';

const layoutOutputs = new Set(['ActualWidth', 'ActualHeight', 'DesiredSize', 'RenderSize',
  'ExtentWidth', 'ExtentHeight', 'ViewportWidth', 'ViewportHeight', 'ScrollableWidth', 'ScrollableHeight']);

/** Feeding computed geometry back into property mirrors must not initiate another arrange pass. */
export function isLayoutOutputProperty(name) { return layoutOutputs.has(name); }

/** One layout authority coalesces completed arrange revisions; geometry-only publication remains silent. */
export class LayoutLifecycle {
  constructor() { this.revision = -1; }

  publish(tree, layouts, {revision, completed = false, suppress = false, resolveNode, observesViewport = () => true} = {}) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Invalid completed layout revision');
    const changed = completed && revision > 0 && revision !== this.revision;
    const notify = changed && !suppress;
    if (!tree) { if (completed) this.revision = revision; return notify; }
    if (!completed || !changed && !suppress) {
      for (const [id, entry] of layouts) {
        if (tree.contains(id)) tree.setBounds(id, entry.bounds, {renderSize: tree.require(id).layoutSize ?? {width: 0, height: 0}, notify: false});
      }
      return false;
    }
    const viewports = computeEffectiveViewports(layouts, {resolveNode});
    this.revision = revision;
    const ids = [];
    // Finish every size notification before viewport and LayoutUpdated callbacks can observe the pass.
    for (const [id, entry] of layouts) {
      if (!tree.contains(id)) continue;
      const node = tree.require(id);
      node.visible = viewports.has(id);
      tree.setBounds(id, entry.bounds, {renderSize: entry.renderSize, notify});
    }
    for (const [id, viewport] of viewports) {
      if (!tree.contains(id) || !tree.require(id).connected) continue;
      ids.push(id);
      if (observesViewport(id)) tree.setEffectiveViewport(id, viewport, {notify});
    }
    if (notify) tree.layoutUpdated(ids);
    return notify;
  }

  snapshot() { return {version: 1, revision: this.revision}; }
  restore(value) {
    if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < -1) {
      throw new TypeError('Invalid layout lifecycle snapshot');
    }
    this.revision = value.revision;
  }
}
