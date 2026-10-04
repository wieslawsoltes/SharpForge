import { openDesignerSource } from './source-editor.js';

/** Apply a designer view mode while retaining source editor and docking ownership. */
export function setDesignerChromeMode(chrome, mode) {
  const view = chrome.view;
  chrome.mode = mode;
  view.preview = mode === 'preview';
  view.resizeArtboard();
  const uri = view.sourceSync.session?.analysis.uri;

  if (mode === 'split' && uri) {
    openDesignerSource(view, uri);
    const location = view.docking.layout.locate('designer');
    const group = location.group?.id ?? location.groupId ?? location.group;
    const target = typeof group === 'string'
      ? group
      : view.docking.layout.groups().find(item => item.panels.includes('designer'))?.id;
    const sourceLocation = view.docking.layout.groups().find(item => item.panels.includes('source:' + uri));
    if (target && sourceLocation?.id === target) {
      view.docking.layout.dock('source:' + uri, target, 'bottom');
      let split;
      view.docking.layout.visit(node => {
        if (node.type === 'split' && node.first.id === target) split = node;
      });
      if (split) view.docking.layout.resize(split.id, .64, { history: false });
    }
    view.docking.activate('designer');
  }

  if (mode === 'code') {
    if (uri) openDesignerSource(view, uri);
    else view.docking.activate('designer-source');
  }

  if (mode === 'design' && uri) {
    const group = view.docking.layout.groups().find(item => item.panels.includes('designer'));
    if (group) view.docking.layout.dock('source:' + uri, group.id, 'center');
    view.docking.activate('designer');
  }

  chrome.renderSync();
  return mode;
}
