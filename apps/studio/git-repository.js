import { gitElement, gitButton } from './git-dom.js';

/** A deterministic tree keeps slash-separated references navigable without changing their names. */
export function buildReferenceTree(refs, prefix) {
  const root = { label: '', children: new Map() };
  for (const ref of refs) {
    if (!ref.name.startsWith(prefix)) continue;
    const parts = ref.name.slice(prefix.length).split('/');
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { label: part, children: new Map() });
      node = node.children.get(part);
    }
    node.ref = ref;
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    node.children = [...node.children.values()].sort((left, right) => left.label < right.label ? -1 : left.label > right.label ? 1 : 0);
    for (const child of node.children) stack.push(child);
  }
  return root.children;
}

/** Native disclosure controls provide keyboard navigation for branches, remotes and tags. */
export async function renderRepositoryReferences(element, workbench, { signal, onSelect } = {}) {
  const data = await workbench.request('repositoryTree', {}, { signal });
  if (signal?.aborted) return;
  const document = element.ownerDocument;
  const filter = gitElement(document, 'input', {
    type: 'search', placeholder: 'Filter references', 'aria-label': 'Filter references', className: 'git-reference-filter'
  });
  const tree = gitElement(document, 'nav', { className: 'git-reference-tree', 'aria-label': 'Repository references' });
  element.replaceChildren(gitElement(document, 'h3', { text: 'References' }), filter,
    gitButton(document, 'All References', () => onSelect(null)), tree);
  const draw = () => {
    const query = filter.value.toLowerCase();
    const filtered = refs => refs.filter(ref => ref.name.toLowerCase().includes(query));
    tree.replaceChildren(
      referenceGroup(document, 'Branches', filtered(data.branches), 'refs/heads/', onSelect),
      referenceGroup(document, 'Remote Branches', filtered(data.remoteBranches), 'refs/remotes/', onSelect),
      referenceGroup(document, 'Tags', filtered(data.tags), 'refs/tags/', onSelect));
    const remotes = gitElement(document, 'details', { open: true, className: 'git-reference-group' },
      gitElement(document, 'summary', { text: 'Remotes' }));
    for (const remote of data.remotes.filter(item => `${item.name} ${item.url}`.toLowerCase().includes(query))) {
      remotes.append(gitElement(document, 'p', { className: 'git-remote-description' },
        gitElement(document, 'strong', { text: remote.name }), gitElement(document, 'span', { text: remote.url })));
    }
    tree.append(remotes);
  };
  filter.addEventListener('input', draw);
  draw();
}

function referenceGroup(document, label, refs, prefix, onSelect) {
  const group = gitElement(document, 'details', { open: true, className: 'git-reference-group' },
    gitElement(document, 'summary', { text: `${label} (${refs.length})` }));
  const nodes = buildReferenceTree(refs, prefix);
  const append = (container, entries, start = 0) => {
    for (const node of entries.slice(start, start + 200)) {
      if (node.children.length) {
        const folder = gitElement(document, 'details', { className: 'git-reference-folder' },
          gitElement(document, 'summary', { text: node.label }));
        let loaded = false;
        folder.addEventListener('toggle', () => {
          if (!folder.open || loaded) return;
          loaded = true;
          append(folder, node.children);
        });
        container.append(folder);
      }
      if (node.ref) container.append(gitButton(document, `${node.label}${node.ref.current ? ' (current)' : ''}`,
        () => onSelect(node.ref.name), { className: 'git-reference', title: `${node.ref.name}\n${node.ref.oid ?? 'Unborn branch'}`,
          'aria-current': node.ref.current ? 'true' : undefined, 'data-ref': node.ref.name }));
    }
    if (entries.length > start + 200) {
      const more = gitButton(document, 'Show More References', () => { more.remove(); append(container, entries, start + 200); });
      container.append(more);
    }
  };
  append(group, nodes);
  if (!refs.length) group.append(gitElement(document, 'p', { className: 'git-muted', text: 'None' }));
  return group;
}
