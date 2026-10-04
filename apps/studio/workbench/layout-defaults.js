import { createGroup, createSplit } from '@sharpforge/docking';
import { toolDefinitions } from '../tools/definitions.js';

export function defaultDockLayout() {
  const documents = createGroup('documents', [], 'document');
  const bottom = createGroup('tools-bottom', ['output', 'problems', 'debug', 'watch', 'stack', 'breakpoints', 'bytecode', 'disassembly', 'assembly']);
  const root = createSplit('split-left', 'horizontal', createSplit('split-bottom', 'vertical', documents, bottom, .72),
    createSplit('split-right', 'vertical', createGroup('tools-left', ['solution', 'outline']),
      createGroup('tools-right', ['properties', 'diagnostics', 'project']), .68), .77);
  const placed = new Set(['solution', 'outline', 'properties', 'diagnostics', 'project', ...bottom.panels]);
  return { version: 1, root, floating: [], autoHide: { left: [], right: [], top: [], bottom: [] },
    closed: toolDefinitions.map(panel => panel.id).filter(id => !placed.has(id)), activePanel: 'output' };
}

export function presetDockLayout(preset, documents) {
  const defaults = defaultDockLayout();
  let documentGroup;
  function find(node) {
    if (node.type === 'group' && node.id === 'documents') documentGroup = node;
    else if (node.type === 'split') { find(node.first); find(node.second); }
  }
  find(defaults.root);
  documentGroup.panels = [...documents];
  documentGroup.active = documents[0] ?? null;
  if (preset === 'build') {
    const bottom = createGroup('tools-bottom', ['msbuild-inspector', 'problems', 'output']);
    const right = createGroup('tools-right', ['msbuild', 'project']);
    documentGroup.panels.push('project-source');
    defaults.root = createSplit('split-left', 'horizontal', createGroup('tools-left', ['solution', 'outline']),
      createSplit('split-right', 'horizontal', createSplit('split-bottom', 'vertical', documentGroup, bottom, .65), right, .60), .16);
    const placed = new Set([...documents, 'project-source', 'solution', 'outline', ...bottom.panels, ...right.panels]);
    defaults.closed = toolDefinitions.map(panel => panel.id).filter(id => !placed.has(id));
    defaults.activePanel = 'msbuild';
  }
  if (preset === 'designer') {
    const toolbox = createGroup('design-left', ['designer-toolbox', 'solution']);
    const outline = createGroup('design-outline', ['designer-tree']);
    const surface = createGroup('design-surface', ['designer', ...documents, 'designer-source'], 'document');
    const properties = createGroup('design-properties', ['designer-properties', 'designer-layout', 'designer-styles']);
    defaults.root = createSplit('design-columns', 'horizontal', createSplit('design-left-stack', 'vertical', toolbox, outline, .50),
      createSplit('design-main', 'horizontal', surface, properties, .73), .16);
    const placed = new Set(['designer-toolbox', 'solution', 'designer-tree', 'designer', 'designer-source', 'designer-properties',
      'designer-layout', 'designer-styles', ...documents]);
    defaults.closed = toolDefinitions.map(panel => panel.id).filter(id => !placed.has(id));
    defaults.activePanel = 'designer';
  }
  return defaults;
}
