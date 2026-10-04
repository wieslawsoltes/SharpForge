import {createGroup, createSplit} from '@sharpforge/docking';

/** A designer layout places ordinary source/design documents between the toolbox and inspector tools. */
export function designerDockPreset(layout, tools) {
  const documentIds = new Set([...layout.panels.values()].filter(panel => panel.kind === 'document').map(panel => panel.id));
  const opened = layout.groups().flatMap(group => group.panels).filter(id => documentIds.has(id));
  const activePanel = layout.snapshot().activePanel;
  const active = opened.includes(activePanel) ? activePanel : opened[0] ?? null;
  const toolbox = createGroup('design-left', ['designer-toolbox', 'solution']);
  const outline = createGroup('design-outline', ['designer-tree']);
  const surface = createGroup('design-surface', opened, 'document');
  surface.active = active;
  const properties = createGroup('design-properties', ['designer-properties', 'designer-layout', 'designer-styles']);
  const root = createSplit('design-columns', 'horizontal', createSplit('design-left-stack', 'vertical', toolbox, outline, .5),
    createSplit('design-main', 'horizontal', surface, properties, .73), .16);
  const placed = new Set([...opened, ...toolbox.panels, ...outline.panels, ...properties.panels]);
  const registered = new Set([...tools.map(tool => tool.id), ...layout.panels.keys()]);
  return {root, closed: [...registered].filter(id => !placed.has(id)), activePanel: active};
}
