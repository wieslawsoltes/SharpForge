import {createGroup, createSplit} from '@sharpforge/docking';
import {toolDefinitions} from './tools/definitions.js';

export function defaultDockLayout() {
  const documents = createGroup('documents', [], 'document');
  const bottom = createGroup('tools-bottom', ['output', 'problems', 'debug', 'watch', 'stack', 'breakpoints', 'bytecode', 'disassembly', 'assembly']);
  const left = createGroup('tools-left', ['solution', 'outline']);
  const right = createGroup('tools-right', ['properties', 'diagnostics', 'project']);
  const root = createSplit('split-left', 'horizontal', createSplit('split-bottom', 'vertical', documents, bottom, .72),
    createSplit('split-right', 'vertical', left, right, .68), .77);
  const placed = new Set(['solution', 'outline', 'properties', 'diagnostics', 'project', ...bottom.panels]);
  return {version: 1, root, floating: [], autoHide: {left: [], right: [], top: [], bottom: []},
    closed: toolDefinitions.map(panel => panel.id).filter(id => !placed.has(id)), activePanel: 'output'};
}

/** Build-oriented docking keeps the existing panel identities while exposing the shared Test Explorer. */
export function applyBuildDockLayout(defaults, documentGroup, documents) {
  const bottom = createGroup('tools-bottom', ['msbuild-inspector', 'tests', 'problems', 'output']);
  const right = createGroup('tools-right', ['msbuild', 'project']);
  documentGroup.panels.push('project-source');
  defaults.root = createSplit('split-left', 'horizontal', createGroup('tools-left', ['solution', 'outline']),
    createSplit('split-right', 'horizontal', createSplit('split-bottom', 'vertical', documentGroup, bottom, .65), right, .60), .16);
  const placed = new Set([...documents, 'project-source', 'solution', 'outline', ...bottom.panels, ...right.panels]);
  defaults.closed = toolDefinitions.map(panel => panel.id).filter(id => !placed.has(id));
  defaults.activePanel = 'msbuild';
}
