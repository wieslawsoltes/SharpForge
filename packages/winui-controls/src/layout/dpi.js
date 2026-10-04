import { roundEdge, roundRect } from './geometry.js';

/** Observe browser zoom/monitor changes without a process-wide listener or cache. */
export class XamlRootMetrics {
  constructor(root, { onChanged = () => {} } = {}) {
    this.root = root;
    this.window = root.ownerDocument.defaultView;
    this.onChanged = onChanged;
    this.rasterizationScale = this.window.devicePixelRatio || 1;
    this.size = { width: root.clientWidth, height: root.clientHeight };
    this.changed = () => this.refresh();
    this.window.addEventListener('resize', this.changed);
    const Observer = this.window.ResizeObserver;
    this.observer = Observer ? new Observer(this.changed) : null;
    this.observer?.observe(root);
    this.watchResolution();
  }
  watchResolution() {
    this.resolution?.removeEventListener?.('change', this.changed);
    this.resolution = this.window.matchMedia?.(`(resolution: ${this.rasterizationScale}dppx)`);
    this.resolution?.addEventListener?.('change', this.changed, { once: true });
  }
  refresh() {
    const scale = this.window.devicePixelRatio || 1;
    const size = { width: this.root.clientWidth, height: this.root.clientHeight };
    if (scale === this.rasterizationScale && size.width === this.size.width && size.height === this.size.height) return;
    this.rasterizationScale = scale;
    this.size = size;
    this.watchResolution();
    this.onChanged({ RasterizationScale: scale, Size: { ...size } });
  }
  dispose() {
    this.window.removeEventListener('resize', this.changed);
    this.resolution?.removeEventListener?.('change', this.changed);
    this.observer?.disconnect();
  }
}

export { roundEdge, roundRect };
