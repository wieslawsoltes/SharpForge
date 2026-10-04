import {DisplayList} from '../drawing/display-list.js';
import {DrawingError} from '../drawing/commands.js';

/** The runtime invokes Draw and publishes its sealed session as DrawingList; adapters share the same display-list ABI. */
export function renderCanvasControl(node, layout, context) {
  const value = node.drawingList ?? node.properties.DrawingList ?? node.properties.DisplayList;
  if (node.properties.ClearColor != null) context.Clear(node.properties.ClearColor);
  if (!value) return;
  const list = DisplayList.from(value);
  context.DrawLayer({displayList: list, cacheKey: `canvas:${node.id}`, contentVersion: list.version});
}

export function registerCanvasHostRenderers(registry) {
  const create = context => context.document.createElement('div');
  registry.register(['CanvasControl', 'CanvasAnimatedControl'], {create, render(context, node) {
    const state = context.getState(node);
    if (!state.canvasCreated) { state.canvasCreated = true; context.services.invalidateCanvas?.(node.id); }
  }}, {override: true});
  registry.register('SwapChainPanel', {create, render(context, node, element) {
    context.ordered(element, context.children(node, 'Children'));
  }}, {override: true});
  return registry;
}

/** Scene command contribution keeps validation and retained drawing state inside the rendering package. */
export function applyDisplayListCommand(context, command, node) {
  if (!node) throw new DrawingError('SFRENDER137', 'Drawing command target is not attached');
  const list = DisplayList.from(command.displayList);
  if (list.elementId && list.elementId !== node.id) throw new DrawingError('SFRENDER138', 'Drawing command target does not match its element');
  node.drawingList = list;
  context.invalidate(node.id, 'render');
}

/** Explicit browser canvas hand-out; external rendering owns its frame submission and cannot dispose the app device. */
export function acquireSwapChainPanel(host, id) {
  const node = host.nodes.get(id), element = host.elements.get(id);
  if (!node?.type.endsWith('.SwapChainPanel') || !element) throw new DrawingError('SFRENDER135', 'An attached SwapChainPanel is required');
  const state = host.context.getState(node);
  if (!state.swapChainCanvas) {
    state.swapChainCanvas = host.document.createElement('canvas'); state.swapChainCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(state.swapChainCanvas.style, {position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none'});
  }
  element.prepend(state.swapChainCanvas);
  const layout = host.getLayout(id), dpr = host.document.defaultView.devicePixelRatio || 1;
  state.swapChainCanvas.width = Math.max(1, Math.ceil(layout.renderSize.width * dpr));
  state.swapChainCanvas.height = Math.max(1, Math.ceil(layout.renderSize.height * dpr));
  const canvas = state.swapChainCanvas;
  return {canvas, deviceService: host.services.device, layout,
    resize: () => acquireSwapChainPanel(host, id), release: () => {
      canvas.remove();
      if (state.swapChainCanvas === canvas) state.swapChainCanvas = null;
    }};
}
