import {WinUIHost} from '@sharpforge/winui';
import {sessionDom} from './a18-session-dom.js';

/** Real host layout/property methods with a deterministic DOM boundary; no GPU or browser timing is simulated. */
export function geometryHost(scene) {
  const {document} = sessionDom();
  const rendered = [];
  const measured = [];
  const layouts = [];
  const frames = new Map();
  let frame = 0;
  Object.assign(document.defaultView, {
    requestAnimationFrame: callback => { frames.set(++frame, callback); return frame; },
    cancelAnimationFrame: id => frames.delete(id)
  });
  const create = document.createElement;
  document.createElement = tag => {
    const element = create(tag);
    Object.defineProperty(element, 'firstChild', {get: () => element.children[0] ?? null});
    Object.defineProperty(element, 'nextSibling', {get: () => {
      const siblings = element.parentElement?.children ?? [];
      return siblings[siblings.indexOf(element) + 1] ?? null;
    }});
    element.removeAttribute = name => element.attributes.delete(name);
    element.getBoundingClientRect = () => {
      measured.push(element.dataset.sfId);
      return {width: Number.parseFloat(element.style.width) || 100, height: Number.parseFloat(element.style.height) || 40};
    };
    return element;
  };
  class Host extends WinUIHost {
    renderNode(node, element) { rendered.push(node.id); super.renderNode(node, element); }
    drawNode() { /* GPU drawing is exercised by browser qualification, not this DOM boundary. */ }
  }
  const host = new Host(document.createElement('div'), {backend: 'dom', onLayout: changes => layouts.push(changes)});
  host.load(scene);
  host.flush();
  const reset = () => { rendered.length = 0; measured.length = 0; layouts.length = 0; };
  reset();
  return {host, rendered, measured, layouts, frames, reset};
}

export function canvasScene(count = 5000) {
  const nodes = [
    {id: 'window', type: 'Microsoft.UI.Xaml.Window', properties: {Content: {$ref: 'canvas'}}, collections: {}, events: []},
    {id: 'canvas', type: 'Microsoft.UI.Xaml.Controls.Canvas', properties: {Width: 1200, Height: 800},
      collections: {Children: []}, events: []}
  ];
  for (let index = 2; index < count; index++) {
    const id = `item${index}`;
    nodes[1].collections.Children.push({$ref: id});
    nodes.push({id, type: 'Microsoft.UI.Xaml.Controls.Button', events: [], collections: {},
      properties: {Name: id, Left: index, Top: index, Width: 140, Height: 40, Content: id}});
  }
  return {version: 1, windows: ['window'], nodes};
}
