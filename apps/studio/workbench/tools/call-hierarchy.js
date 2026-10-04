import {createToolTree} from './tree-host.js';
import {button, select, runAction} from '../ui.js';
export {CallHierarchyModel} from './call-hierarchy-model.js';

export function mountCallHierarchy(host, {model, context, navigate, onError}) {
  let scope = 'solution';
  const tree = createToolTree(host, {label: 'Call Hierarchy', onError,
    onOpen: node => node.item && navigate(model.location(node)),
    onSelect: node => {
      if (!node?.ranges) return;
      tree.details.replaceChildren();
      for (const range of node.ranges) tree.details.append(button(host.ownerDocument,
        range.uri + ':' + range.start, runAction(() => navigate(model.location(node, range)), onError)));
    }, onExpand: async node => {
      await model.expand(node);
      const update = nodes => {
        for (const entry of nodes) {
          if (entry.id === node.id) { Object.assign(entry, node); return true; }
          if (update(entry.children ?? [])) return true;
        }
        return false;
      };
      update(model.roots);
      render();
    }});
  const render = () => {
    const roots = scope === 'document' ? model.roots.filter(node => node.item.uri === context().uri) : model.roots;
    tree.setNodes(roots);
    tree.status.textContent = roots.length + ' roots · expand Calls To or Calls From to load calls';
  };
  const prepare = runAction(async () => {
    await model.prepare(context());
    render();
  }, onError);
  tree.toolbar.append(button(host.ownerDocument, 'Add symbol at caret', prepare),
    button(host.ownerDocument, 'Refresh', runAction(async () => { model.clear(); await prepare(); }, onError)),
    button(host.ownerDocument, 'Remove root', () => {
      const selected = [...tree.model.selected][0];
      const root = model.roots.find(node => selected === node.id || selected?.startsWith(node.id + ':'));
      model.roots = model.roots.filter(node => node !== root);
      render();
    }), select(host.ownerDocument, 'Call hierarchy scope', [{value: 'solution', label: 'Entire solution'},
      {value: 'document', label: 'Current document'}], scope, value => { scope = value; render(); }));
  render();
  if (!model.roots.length && context().uri) prepare();
  return {refresh: render, prepare, dispose: () => tree.dispose()};
}
