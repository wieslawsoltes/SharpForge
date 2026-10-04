import { frameworkType } from '@sharpforge/framework';
import * as controls from '@sharpforge/winui-controls';
import { RenderSurface, cssColor, parseColor, drawingPrimitives } from './surface.js';
import { RetainedSceneRenderer, Canvas2DBackend, DrawingContext, DrawingError, DisplayList, transformValue, normalizeBrush } from '@sharpforge/rendering';
import {registerImageHostRenderer, registerCanvasHostRenderers, acquireSwapChainPanel, applyDisplayListCommand} from '@sharpforge/rendering';
import {createRenderingMeasureProvider} from '@sharpforge/rendering';

/** Compatibility facade composes package contracts without introducing a framework/controls dependency cycle. */
export class WinUIHost extends controls.RetainedWinUIHost {
  constructor(root, options = {}) {
    const registry = options.registry ?? new controls.RendererRegistry({ resolveType: frameworkType });
    if (!options.registry) {
      controls.registerLegacyRenderers(registry);
      controls.registerControlFamilies?.(registry);
    }
    const services = {...options.services};
    const renderer = new RetainedSceneRenderer(root, {...options, resources: services.resources,
      deviceService: services.device, textService: services.text, resolveImage: options.resolveImage ?? services.resolveImage,
      resolveType: frameworkType});
    registerImageHostRenderer(registry, renderer);
    registerCanvasHostRenderers(registry);
    services.resources ??= renderer.resources; services.device ??= renderer.deviceService; services.text ??= renderer.textService;
    services.renderTransform ??= transformValue;
    const commandHandlers = new Map(options.commandHandlers ?? []);
    commandHandlers.set('displayList', applyDisplayListCommand);
    const resolve = value => value?.$ref ? renderer.host?.nodes.get(value.$ref) : value;
    const measureProvider = options.measureProvider ?? createRenderingMeasureProvider({
      fallback: new controls.MeasureProvider({document: root.ownerDocument, resolve: id => renderer.host?.nodes.get(id)}),
      textService: renderer.textService, resolve, textScale: () => services.textScale?.factor ?? 1});
    super(root, {...options, services, registry, frameworkType, commandHandlers, measureProvider,
      drawing: {RenderSurface, cssColor, parseColor, drawingPrimitives},
      renderDelegate: (context, node, layout) => options.renderDelegate?.(context, node, layout) === true || renderer.collect(context.host, node, layout),
      renderComposition: (context, id, layer, resources) => {
        renderer.collectComposition(context.host, id, layer, resources);
        options.renderComposition?.(context, id, layer, resources);
      },
      renderFrame: context => { renderer.renderFrame(); options.renderFrame?.(context); }});
    this.sceneRenderer = renderer;
    renderer.host = this;
    this.context.color = value => {
      if (value == null) return 'transparent';
      const brush = normalizeBrush(value?.$ref ? this.nodes.get(value.$ref) : value, renderer.resources,
        item => item?.$ref ? this.nodes.get(item.$ref) : item);
      const color = [...(brush.color ?? brush.fallback ?? brush.stops?.[0]?.color ?? [0, 0, 0, 0])];
      color[3] *= brush.opacity; return cssColor(color);
    };
    services.layout ??= {getLayout: value => this.getLayout(value?.id ?? value?.$ref ?? value)};
    services.invalidateRendering ??= value => this.invalidate(value?.id ?? value?.$ref ?? value, 'render');
    services.renderToBitmap ??= (value, captureOptions) => this.renderToBitmap(value?.id ?? value?.$ref ?? value, captureOptions);
    services.acquireSwapChainPanel ??= id => acquireSwapChainPanel(this, id);
    services.drawing = {DrawingContext, DisplayList};
  }
  setBackend(backend) { this.sceneRenderer.setBackend(backend); super.setBackend(backend); }
  async settled() { await super.settled(); await this.sceneRenderer.settled(); this.flush(); }
  async renderToBitmap(id, {width, height, signal} = {}) {
    signal?.throwIfAborted();
    this.flush(); await this.sceneRenderer.settled();
    signal?.throwIfAborted();
    const record = this.sceneRenderer.capture(id);
    width ??= Math.max(1, Math.ceil(record.width));
    height ??= Math.max(1, Math.ceil(record.height));
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 16384) || width * height > 16777216) {
      throw new DrawingError('SFRENDER065', 'Bitmap capture dimensions exceed the positive integer pixel budget');
    }
    const drawing = new DrawingContext();
    drawing.PushTransform([width / Math.max(1, record.width), 0, 0, height / Math.max(1, record.height), 0, 0]);
    drawing.DrawLayer({displayList: record.list}); drawing.Pop();
    const canvas = this.document.createElement('canvas');
    const backend = new Canvas2DBackend(canvas, {textService: this.sceneRenderer.textService});
    try {
      backend.render(drawing.finish(), this.sceneRenderer.resources, {width, height, dpr: 1,
        resolve: value => value?.$ref ? this.nodes.get(value.$ref) : value});
      signal?.throwIfAborted();
      return {width: canvas.width, height: canvas.height, pixels: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data};
    } finally { backend.dispose(); }
  }
  acquireSwapChainPanel(id) { return acquireSwapChainPanel(this, id); }
  dispose() { super.dispose(); this.sceneRenderer.dispose(); }
}
