import {DesignDocument} from '@sharpforge/designer';
import {DesignerSurfaceGeometry} from '../../apps/studio/designer-surface-geometry.js';

/** Deterministic DOM read counters qualify cache invalidation; the browser gate owns all timing claims. */
export function surfaceMetrics(count = 5000) {
  const state = {x: 100, y: 80, zoom: 2, reads: 0, baselines: 0, fonts: 0};
  const frames = new Map();
  let serial = 0;
  const browserDocument = {defaultView: {
    performance: {now: () => (state.reads + state.baselines) * .125},
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(element) {
      return {width: `${element.width}px`, height: `${element.height}px`, boxSizing: 'border-box', font: '13px TestFont',
        transform: element.stage ? `matrix(${state.zoom}, 0, 0, ${state.zoom}, 0, 0)` : 'none'};
    }
  }};
  browserDocument.createElement = () => ({getContext: () => ({measureText() {
    state.fonts++;
    return {fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3};
  }})});
  browserDocument.createRange = () => {
    let text;
    return {selectNodeContents(value) { text = value; }, detach() {}, getClientRects() {
      state.baselines++;
      return [{left: state.x + (text.owner.left + 2) * state.zoom, top: state.y + (text.owner.top + 2) * state.zoom,
        width: 10 * state.zoom, height: 13 * state.zoom}];
    }};
  };
  const element = ({width, height, left = 0, top = 0, parentElement = null, stage = false, text = false}) => {
    const value = {ownerDocument: browserDocument, width, height, left, top, stage, parentElement, isConnected: true,
      childNodes: [], getBoundingClientRect() {
        state.reads++;
        return {left: state.x + left * state.zoom, top: state.y + top * state.zoom,
          width: width * state.zoom, height: height * state.zoom};
      }};
    if (text) value.childNodes.push({nodeType: 3, textContent: 'Text', owner: value});
    return value;
  };
  const stage = element({width: 2400, height: 1600, stage: true});
  const canvas = element({width: 2400, height: 1600, parentElement: stage});
  const nodes = [{id: 'canvas', type: 'Canvas', properties: {Width: 2400, Height: 1600}, children: []}];
  const elements = new Map([['canvas', canvas]]);
  for (let index = 0; index < count - 1; index++) {
    const id = `n${index}`;
    const left = index % 80 * 30;
    const top = Math.floor(index / 80) * 25;
    nodes[0].children.push(id);
    nodes.push({id, type: 'Button', properties: {Left: left, Top: top, Width: 24, Height: 20, Content: 'Text'}, children: []});
    elements.set(id, element({width: 24, height: 20, left, top, parentElement: canvas, text: true}));
  }
  const document = new DesignDocument({version: 1, name: 'Viewport cache', width: 2400, height: 1600, root: 'canvas', nodes});
  document.select('n0');
  const view = {document, stage, host: {elements, sceneRevision: 0}, safe: action => action()};
  const geometry = new DesignerSurfaceGeometry(view);
  const tick = () => {
    const next = frames.entries().next().value;
    if (!next) return;
    frames.delete(next[0]);
    next[1]();
  };
  return {state, view, geometry, frames, tick, dispose() { geometry.dispose(); document.dispose(); }};
}
