import {createToolTree} from './tree-host.js';
import {button, runAction} from '../ui.js';

/** Browses the actual registered framework contracts and inspected assembly summaries. */
export async function objectBrowserNodes(assemblies = []) {
  const {types, contracts, propertiesFor, eventsFor} = await import('@sharpforge/framework');
  const members = new Map();
  for (const contract of contracts) {
    const owner = members.get(contract.owner) ?? [];
    owner.push(contract);
    members.set(contract.owner, owner);
  }
  const namespaces = new Map();
  for (const type of types.values()) {
    const namespace = type.name.slice(0, type.name.lastIndexOf('.')) || '(global)';
    let group = namespaces.get(namespace);
    if (!group) namespaces.set(namespace, group = {id: 'framework:namespace:' + namespace, label: namespace, children: []});
    const children = (members.get(type.name) ?? []).map(contract => ({
      id: 'framework:contract:' + contract.id,
      label: contract.name, detail: `${contract.isStatic ? 'static ' : ''}${contract.result} ${contract.owner}.${contract.name}` +
        `(${contract.parameters.join(', ')})\nContract ${contract.id} · ${contract.kind}`, children: []
    }));
    for (const [name, property] of Object.entries(propertiesFor(type.name))) children.push({
      id: 'framework:property:' + type.name + ':' + name, label: name,
      detail: `${property.type} ${type.name}.${name} { get; ${property.readOnly ? '' : 'set; '}}`, children: []
    });
    for (const [name, delegate] of Object.entries(eventsFor(type.name))) children.push({
      id: 'framework:event:' + type.name + ':' + name, label: name, detail: `event ${delegate} ${type.name}.${name}`, children: []
    });
    group.children.push({id: 'framework:type:' + type.name, label: type.name.split('.').at(-1),
      detail: `${type.kind} ${type.name}${type.base ? ' : ' + type.base : ''}\nSharpForge framework metadata`, children});
  }
  const roots = [{id: 'framework', label: 'SharpForge Framework (registered contract metadata)', children: [...namespaces.values()]}];
  for (const assembly of assemblies) {
    const summary = assembly.summary ?? assembly;
    const id = 'assembly:' + summary.name;
    roots.push({id, label: summary.name, children: (summary.types ?? []).map(type => ({
      id: id + ':type:' + type.token, label: type.name,
      detail: JSON.stringify(type, null, 2), children: (summary.methods ?? []).filter(method =>
        method.owner === type.name || method.owner === type.fullName).map(method => ({
        id: id + ':method:' + method.token, label: method.name,
        detail: method.signature ?? JSON.stringify(method, null, 2), metadata: {assembly, method}, children: []
      }))}))});
  }
  return roots;
}

export function mountObjectBrowser(host, {assemblies = () => [], inspect, onError}) {
  let disposed = false;
  const tree = createToolTree(host, {label: 'Object Browser', onError, onOpen: node => node.metadata && inspect?.(node.metadata)});
  const refresh = runAction(async () => {
    const nodes = await objectBrowserNodes(assemblies());
    if (!disposed) {
      tree.setNodes(nodes);
      tree.status.textContent = 'Registered framework contracts and loaded assembly metadata. Unloaded external assemblies are not indexed.';
    }
  }, onError);
  tree.toolbar.append(button(host.ownerDocument, 'Refresh metadata', refresh));
  refresh();
  return {refresh, dispose: () => { disposed = true; tree.dispose(); }};
}
