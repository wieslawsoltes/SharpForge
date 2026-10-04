import { gitDialog } from './git-dom.js';

const dirtyPaths = workbench => [...workbench.host.getState().dirtyFiles];

export async function showGitBranchPicker(workbench) {
  const branches = await workbench.request('branches');
  return gitDialog(document, {
    title: 'Switch Branch', submitLabel: 'Switch',
    fields: [{ name: 'revision', label: 'Branch', options: branches.map(branch =>
      ({ value: branch.name, label: branch.name.replace('refs/heads/', '') })) }],
    onCancel: () => workbench.controller?.abort(),
    onSubmit: values => workbench.run(async options => {
      await workbench.synchronize(options);
      await workbench.request('checkout', { revision: values.revision, dirtyPaths: dirtyPaths(workbench) }, options);
      await workbench.adoptRepository(options);
    }, { workspace: true })
  });
}

export function showCreateGitBranch(workbench) {
  return gitDialog(document, {
    title: 'Create Branch', submitLabel: 'Create Branch', fields: [
      { name: 'name', label: 'Branch name', required: true },
      { name: 'start', label: 'Start revision', value: 'HEAD', required: true },
      { name: 'checkout', label: 'Switch to new branch', type: 'checkbox', checked: true }
    ], onCancel: () => workbench.controller?.abort(),
    onSubmit: values => workbench.run(async options => {
      await workbench.synchronize(options);
      await workbench.request('branch', { name: values.name, start: values.start }, options);
      if (values.checkout) {
        await workbench.request('checkout', { revision: values.name, dirtyPaths: dirtyPaths(workbench) }, options);
        await workbench.adoptRepository(options);
      }
    }, { workspace: values.checkout })
  });
}

export async function showMergeGitBranch(workbench) {
  const branches = await workbench.request('branches');
  return gitDialog(document, {
    title: 'Merge Branch', submitLabel: 'Merge',
    fields: [{ name: 'revision', label: 'Revision to merge', options: branches.map(branch =>
      ({ value: branch.name, label: branch.name.replace('refs/heads/', '') })) }],
    onCancel: () => workbench.controller?.abort(),
    onSubmit: values => workbench.run(async options => {
      await workbench.synchronize(options);
      const result = await workbench.request('merge', { revision: values.revision,
        dirtyPaths: dirtyPaths(workbench) }, options);
      await workbench.adoptRepository(options);
      if (result.conflicts?.length) workbench.openMerge(result.conflicts[0].path);
    }, { workspace: true })
  });
}
