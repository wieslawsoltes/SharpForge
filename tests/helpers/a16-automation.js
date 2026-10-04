import { RendererRegistry } from '../../packages/winui-controls/src/registry.js';
import { AutomationTree } from '../../packages/winui-controls/src/automation/automation-tree.js';

export function automationFixture(records, options = {}) {
  const nodes = new Map(records.map(node => [node.id, { properties: {}, collections: {}, ...node }]));
  const parents = new Map();
  for (const node of nodes.values()) for (const ref of node.collections.Children ?? []) parents.set(ref.$ref, node.id);
  const registry = new RendererRegistry();
  registry.register('*', {});
  const events = [];
  const actions = [];
  const worldLayout = new Map([...nodes.values()].map((node, index) => [node.id, { id: node.id,
    parentId: parents.get(node.id) ?? null, node, bounds: { x: 0, y: index * 32, width: 100, height: 32 },
    worldTransform: [1, 0, 0, 1, 0, index * 32], renderSize: { width: 100, height: 32 } }]));
  const host = { nodes, registry, worldLayout, document: null, elements: new Map(), rootKey: 'test-root', windows: ['root'],
    services: {}, options: { onAutomationEvent: event => events.push(event), onError: error => { throw error; } },
    frameworkType: () => null, parentOf: id => parents.get(id) ?? null, getLayout: id => worldLayout.get(id) ?? null,
    visualChildren: node => (node.collections.Children ?? []).map(value => value.$ref),
    focusManager: { focusedElement: null, focus(id) { this.focusedElement = id; return true; } },
    invoke(id, method, args) { actions.push({ id, method, args }); return options.invoke?.(nodes.get(id), method, args); },
    flush() {}, invalidate() {} };
  host.context = { host, nodes, services: host.services };
  const tree = new AutomationTree(host, { schedule: () => {}, ...options });
  return { host, tree, nodes, events, actions, peer: id => tree.getPeer(id) };
}

export function automationNode(id, type, properties = {}, children = []) {
  return { id, type, properties, collections: { Children: children.map($ref => ({ $ref })) } };
}
