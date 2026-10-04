import {LayerCache} from '../layer-cache.js';
import {describeLayerRaster, hasBackdropDependency} from '../layer-raster-key.js';
import {premultipliedRaster, writePremultiplied} from '../brushes/rasterizer.js';
import {evaluateWorkingEffect} from '../brushes/working-effects.js';
import {paintCanvasShadow} from './canvas-shadow.js';

/** Static local content is rasterized once and reused at new scroll/transform positions. */
export class CanvasLayerRasters {
  constructor({createCanvas, createRenderer, maxBytes = 64 * 1024 * 1024}) {
    this.createCanvas = createCanvas;
    this.createRenderer = createRenderer;
    this.cache = new LayerCache({maxBytes});
    this.subscriptions = new Map();
  }
  acquire(layer, resources, options) {
    const description = describeLayerRaster(layer, resources, options);
    if (!description) return null;
    if (resources?.subscribe && !this.subscriptions.has(resources)) {
      this.subscriptions.set(resources, resources.subscribe(event => this.cache.invalidateResource(event.handle)));
    }
    const create = () => {
      const canvas = this.createCanvas(description.width, description.height);
      const renderer = this.createRenderer(canvas, this);
      try {
        renderer.render(description.list, resources, {...options, width: description.bounds[2], height: description.bounds[3], clear: true});
        if (layer.effect) {
          const source = premultipliedRaster({source: canvas, width: canvas.width, height: canvas.height});
          writePremultiplied(canvas.getContext('2d'), evaluateWorkingEffect(layer.effect, {Source: source, source},
            {...options, width: canvas.width, height: canvas.height}));
        }
        if (layer.shadow) paintCanvasShadow(canvas, layer.shadow, resources, {...options, createCanvas: this.createCanvas,
          bounds: description.bounds, contentBounds: description.contentBounds});
      } finally { renderer.dispose(); }
      return {canvas, bounds: description.bounds};
    };
    const bytes = description.width * description.height * 4;
    if (bytes > this.cache.maxBytes || hasBackdropDependency(layer.displayList.commands, resources)) return {...create(), transient: true};
    return this.cache.getOrCreate(description.key, {version: description.version, bytes, resources: description.handles, create,
      destroy: value => { value.canvas.width = value.canvas.height = 0; }});
  }
  dispose() {
    this.cache.dispose();
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }
}
