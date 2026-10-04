const designPanels = ['designer', 'designer-toolbox', 'designer-tree', 'designer-properties',
  'designer-layout', 'designer-styles', 'designer-source'];

/** Restored or programmatically selected panels activate just as pointer-opened panels do. */
export function observeVisibleFeatures(docking, features) {
  const renderers = new Map([
    ['assembly', element => features.assembly.render(element)],
    ['disassembly', element => features.disassembly.render(element, features.debugSnapshot())],
    ...['msbuild', 'msbuild-inspector', 'project-source'].map(id => [id, element => features.native.render(id, element)]),
    ...designPanels.map(id => [id, element => features.designer.renderTool(id, element)])
  ]);
  let visible = new Map();
  const refresh = () => {
    const next = new Map();
    for (const group of docking.layout.groups()) {
      const id = group.active;
      const element = docking.content.get(id);
      const render = renderers.get(id);
      if (!render || !element || element.isConnected === false) continue;
      next.set(id, element);
      if (visible.get(id) !== element) render(element);
    }
    visible = next;
  };
  const off = docking.layout.subscribe(refresh);
  refresh();
  return off;
}
