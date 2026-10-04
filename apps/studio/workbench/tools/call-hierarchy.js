import {createToolTree} from './tree-host.js';
import {button, select, runAction} from '../ui.js';
import {cancellable} from '../events.js';

export class CallHierarchyModel {
  constructor({request, documents}) { this.request = request; this.documents = documents; this.roots = []; this.controllers = new Set(); }
  async prepare(location, {signal} = {}) {
    const items = await cancellable(this.request('callHierarchy', {uri: location.uri, offset: location.offset ?? location.start}), signal);
    const version = this.documents.get(location.uri)?.version;
    const roots = items.map(item => this.node(item, 'root:' + item.id, version));
    for (const root of roots) if (!this.roots.some(item => item.id === root.id)) this.roots.push(root);
    return roots;
  }
  node(item, id, version) {
    return {id, item, version, label: item.detail ?? item.name, detail: item.detail ?? item.name, children: [
      {id: id + ':incoming', label: 'Calls To', direction: 'incoming', item, version, branch: true, children: []},
      {id: id + ':outgoing', label: 'Calls From', direction: 'outgoing', item, version, branch: true, children: []}
    ]};
  }
  async expand(node) {
    if (!node.direction || node.loaded) return;
    if (this.documents.get(node.item.uri)?.version !== node.version) throw new Error('Call hierarchy is stale; refresh the root');
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const calls = await cancellable(this.request(node.direction === 'incoming' ? 'incomingCalls' : 'outgoingCalls',
        {item: node.item}), controller.signal);
      controller.signal.throwIfAborted();
      node.children = calls.map((call, index) => ({...this.node(call.item, node.id + ':' + index,
        this.documents.get(call.item.uri)?.version), ranges: call.ranges}));
      node.loaded = true;
    } finally { this.controllers.delete(controller); }
  }
  dispose() { for (const controller of this.controllers) controller.abort(); this.roots = []; }
}

export function mountCallHierarchy(host, {model, context, navigate, onError}) {
  let scope = 'solution';
  const tree = createToolTree(host, {label: 'Call Hierarchy', onError,
    onOpen: node => node.item && navigate({...node.item, start: node.item.selectionStart ?? node.item.start}),
    onSelect: node => {
      if (!node?.ranges) return;
      tree.details.replaceChildren();
      for (const range of node.ranges) tree.details.append(button(host.ownerDocument,
        range.uri + ':' + range.start, runAction(() => navigate(range), onError)));
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
    button(host.ownerDocument, 'Refresh', runAction(async () => { model.roots = []; await prepare(); }, onError)),
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
