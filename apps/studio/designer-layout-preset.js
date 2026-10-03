import {createGroup, createSplit} from '@sharpforge/docking';

/** A designer layout places ordinary source/design documents between the toolbox and inspector tools. */
export function designerDockPreset(layout, tools) {
  const documentIds = [...layout.panels.keys()].filter(id => id.startsWith('source:'));
  const opened = documentIds.filter(id => layout.locate(id).kind !== 'closed');
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
  return {root, closed: [...tools.map(tool => tool.id), ...documentIds].filter(id => !placed.has(id)), activePanel: active};
}
