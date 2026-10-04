/** Build searchable declaration rows from metadata; large assemblies yield while preparing UI data. */
export async function metadataTree(assemblies, {diagnostics = [], signal} = {}) {
  const roots = [];
  let count = 0;
  for (const assembly of assemblies) {
    const id = assembly.kind === 'framework' ? 'framework' : 'assembly:' +
      [assembly.source.projectId ?? '', assembly.source.id, assembly.identity, assembly.mvid ?? ''].map(encodeURIComponent).join(':');
    const namespaces = new Map();
    const identity = assembly.identity + (assembly.mvid ? '\nMVID: ' + assembly.mvid : '') +
      '\nSource: ' + (assembly.source.path ?? assembly.source.id) + ' · version ' + assembly.source.version;
    for (const type of assembly.types) {
      signal?.throwIfAborted();
      const namespace = type.namespace || '(global)';
      let group = namespaces.get(namespace);
      if (!group) namespaces.set(namespace, group = {id: id + ':namespace:' + namespace, label: namespace, children: []});
      const children = type.members.map(member => ({id: id + ':member:' + type.token + ':' + member.token,
        label: member.name, detail: member.signature + '\nOwner: ' + type.name + '\n' + identity,
        searchText: type.name + '.' + member.name + ' ' + member.signature, children: [],
        metadata: {assembly, type, member}}));
      group.children.push({id: id + ':type:' + type.token, label: type.displayName.slice(type.namespace ? type.namespace.length + 1 : 0),
        detail: type.signature + '\n' + identity, searchText: type.name, children, metadata: {assembly, type}});
      if (++count % 128 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    roots.push({id, label: assembly.name + (assembly.kind === 'framework' ? ' (registered contract metadata)' : ' ' + assembly.version) +
      (assembly.source.projectId ? ' · ' + assembly.source.projectId : ''), detail: identity, children: [...namespaces.values()]});
  }
  for (const [index, diagnostic] of diagnostics.entries()) roots.push({
    id: 'metadata-diagnostic:' + index + ':' + diagnostic.source.id, label: diagnostic.source.name + ' — metadata unavailable',
    detail: diagnostic.code + ': ' + diagnostic.message, children: []
  });
  return roots;
}
