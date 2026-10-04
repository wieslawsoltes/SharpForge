import {DesignDocument, validateDesign, designScene, generateDesignCode} from '@sharpforge/designer';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {WinUIHost} from '@sharpforge/winui';
import {DesignerSurfaceGeometry} from './designer-surface-geometry.js';

const node = (id, type, properties = {}, children = []) => ({id, type, properties: {Name: id, ...properties}, children, events: {}});

/** Reference scenes are real designer documents that compile and run through source VM and direct CIL. */
export function designerLayoutReferences() {
  const make = (name, nodes) => validateDesign({version: 1, name, width: 800, height: 600,
    root: 'window', nodes: [{id: 'window', type: 'Window', properties: {Title: name}, children: ['panel']}, ...nodes],
    styles: {}, templates: {}});
  return [
    make('Canvas', [node('panel', 'Canvas', {Width: 360, Height: 240}, ['first', 'second']),
      node('first', 'Button', {Left: 12.5, Top: 18.25, Width: 100.5, Height: 40, Content: 'Canvas'}),
      node('second', 'TextBlock', {Left: 150, Top: 70, Width: 120, Height: 24, Text: 'Canvas text'})]),
    make('Grid', [{...node('panel', 'Grid', {Width: 360, Height: 240}, ['first', 'second']), rows: ['Auto', '*'], columns: [120, '2*']},
      node('first', 'TextBlock', {Text: 'Auto row', Height: 32, Row: 0, ColumnSpan: 2}),
      node('second', 'Button', {Content: 'Star column', Row: 1, Column: 1, Margin: 4})]),
    make('StackPanel', [node('panel', 'StackPanel', {Width: 360, Height: 240, Spacing: 10}, ['first', 'second']),
      node('first', 'Button', {Content: 'First', Width: 120, Height: 40}),
      node('second', 'Button', {Content: 'Second', Width: 160, Height: 50})]),
    make('ScrollViewer', [node('panel', 'ScrollViewer', {Width: 360, Height: 240}, ['content']),
      node('content', 'Canvas', {Width: 720, Height: 600}, ['first']),
      node('first', 'Button', {Content: 'Scrollable', Left: 125, Top: 90, Width: 160, Height: 40})]),
    make('Viewbox', [node('panel', 'Viewbox', {Width: 360, Height: 240}, ['content']),
      node('content', 'Canvas', {Width: 180, Height: 120}, ['first']),
      node('first', 'Button', {Content: 'Scaled', Left: 12, Top: 20, Width: 120, Height: 32})])
  ];
}

function runtimeScene(document, backend) {
  const source = generateDesignCode(document) + '\nclass Program { static void Main() { DesignedView.Create(); } }';
  const compiled = compileToIL(source);
  if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
  const vm = backend === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(compiled.image);
  const result = vm.run();
  if (result.state !== 'terminated') throw new Error(result.fault?.message ?? `Runtime ended in ${result.state}`);
  return vm.platform.scene();
}

/** Browser-only real DOM geometry qualification. Returns backend-specific differences in physical pixels. */
export async function runDesignerLayoutReferences(root, {tolerance = .5} = {}) {
  const owner = root.ownerDocument;
  const results = [];
  for (const document of designerLayoutReferences()) {
    for (const backend of ['source', 'cil']) {
      const designerRoot = owner.createElement('div');
      const runtimeRoot = owner.createElement('div');
      for (const container of [designerRoot, runtimeRoot]) {
        Object.assign(container.style, {position: 'relative', width: `${document.width}px`, height: `${document.height}px`});
        root.append(container);
      }
      const designerHost = new WinUIHost(designerRoot, {backend: 'dom'});
      const runtimeHost = new WinUIHost(runtimeRoot, {backend: 'dom'});
      let geometry;
      try {
        designerHost.load(designScene(document));
        runtimeHost.load(runtimeScene(document, backend));
        designerHost.flush();
        runtimeHost.flush();
        await new Promise(resolve => owner.defaultView.requestAnimationFrame(resolve));
        designerHost.flush();
        runtimeHost.flush();
        geometry = new DesignerSurfaceGeometry({stage: designerRoot, scroller: designerRoot,
          document: new DesignDocument(document), host: designerHost});
        geometry.refresh({all: true});
        const runtimeNames = new Map([...runtimeHost.nodes.values()].filter(item => item.properties.Name)
          .map(item => [item.properties.Name, runtimeHost.elements.get(item.id)]));
        const origin = runtimeRoot.getBoundingClientRect();
        const differences = [];
        for (const entry of geometry.entries.values()) {
          if (!entry.node.properties.Name) continue;
          const element = runtimeNames.get(entry.node.properties.Name);
          if (!element) throw new Error(`Missing runtime visual ${entry.node.properties.Name}`);
          const actual = element.getBoundingClientRect();
          const values = [actual.left - origin.left, actual.top - origin.top, actual.width, actual.height];
          const expected = [entry.bounds.Left, entry.bounds.Top, entry.bounds.Width, entry.bounds.Height];
          const maximumError = Math.max(...values.map((value, index) => Math.abs(value - expected[index])));
          if (maximumError > tolerance) differences.push({id: entry.id, expected, actual: values, maximumError});
        }
        results.push({scene: document.name, backend, renderer: 'WinUIHost DOM', tolerance, pass: differences.length === 0, differences});
      } finally {
        geometry?.dispose();
        designerHost.dispose();
        runtimeHost.dispose();
        designerRoot.remove();
        runtimeRoot.remove();
      }
    }
  }
  return results;
}
