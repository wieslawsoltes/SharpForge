/** Decorate only mounted explorer rows using the repository's actual status records. */
export function decorateGitExplorer(document, changes) {
  const status = new Map(changes.map(change => [change.path, change.code ?? change.xy]));
  for (const element of document.querySelectorAll('#file-tree [data-tree-id]')) {
    const value = status.get(element.dataset.file);
    element.dataset.gitStatus = value ?? '';
    if (value) element.setAttribute('aria-description', `Git status ${value}`);
    else element.removeAttribute('aria-description');
  }
}

/** The explorer's optional menu contribution carries exact selected paths into the Git facade. */
export function gitExplorerItems(node, nodes, invoke) {
  const paths = [...new Set((nodes?.length ? nodes : [node]).filter(item => item?.path && !item.branch).map(item => item.path))];
  if (!paths.length) return [];
  const action = run => () => invoke(workbench => run(workbench));
  const mutate = method => action(workbench => workbench.run(async options => {
    await workbench.synchronize(options);
    await workbench.request(method, { paths }, options);
  }));
  const items = [
    { label: 'Stage', action: mutate('add') }, { label: 'Unstage', action: mutate('unstage') },
    { label: 'Undo Working Changes…', action: action(workbench => workbench.run(async options => {
      if (!globalThis.confirm(`Restore these files from the Git index?\n${paths.join('\n')}`)) return;
      await workbench.synchronize(options);
      await workbench.request('restore', { paths, worktree: true, force: true }, options);
      await workbench.adoptRepository(options);
    }, { workspace: true })) }
  ];
  if (paths.length === 1) items.push(null,
    { label: 'View Diff', action: action(workbench => workbench.openDiff(paths[0])) },
    { label: 'View History', action: action(workbench => {
      workbench.historyPath = paths[0];
      workbench.host.showPanel('git-repository');
    }) },
    { label: 'Blame', action: action(workbench => {
      workbench.selection = { path: paths[0], blame: true };
      workbench.host.showPanel('git-diff');
    }) });
  return [null, { label: 'Git', children: items }];
}
