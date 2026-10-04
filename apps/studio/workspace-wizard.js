import {addSolutionItem, readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {validateFilePlan} from '@sharpforge/templates';

/** Publish a completed wizard plan, keeping binary records and the directory selected in the wizard attached. */
export async function commitWorkspaceWizard(host, plan, {add, kind, context, node, disk, directoryHandle} = {}) {
  const {state, actions} = host;
  if (host.context().identity !== context.identity) throw new Error('Workspace changed; reopen the wizard');
  if (state.readOnly) throw new Error('Stop debugging before applying the plan');
  if (!add && kind === 'project') {
    if ((state.dirtyFiles.size || state.membershipDirty) && !host.confirm(
      'Replace this workspace? Export a ZIP first to retain unsaved files. Recovery keeps the previous workspace.')) {
      throw new Error('Creation cancelled; current workspace was preserved');
    }
    if (!disk && directoryHandle) disk = await readDirectory(directoryHandle);
    const opened = await host.load(disk?.records ?? plan.records, {disk, entry: plan.entry, startup: plan.startup,
      folders: disk?.folders ?? plan.folders, name: plan.name,
      mode: plan.entry ? /\.(slnx|sln)$/i.test(plan.entry) ? 'solution' : 'project' : 'folder'});
    if (!opened) throw new Error('Creation cancelled; existing workspace was preserved');
  } else {
    const current = host.context();
    validateFilePlan(plan, current.records);
    for (const edit of plan.modifications ?? []) {
      if (current.records.find(record => record.path === edit.path)?.text !== edit.expectedText) {
        throw new Error('Project XML changed: ' + edit.path);
      }
    }
    actions.operationIdentity = context.identity;
    actions.readSet = new Map((plan.modifications ?? []).map(edit => [edit.path, edit.expectedText]));
    const modifications = [...(plan.modifications ?? [])];
    if (['solution-folder', 'solution'].includes(node?.kind) && context.solutionPath && !modifications.length) {
      const original = current.records.find(record => record.path === context.solutionPath)?.text;
      if (typeof original === 'string') {
        let text = original;
        for (const record of plan.records) text = addSolutionItem(text, {solutionPath: context.solutionPath,
          path: record.path, folder: node.solutionFolder ?? 'Solution Items'});
        modifications.push({path: context.solutionPath, text, expectedText: original});
        actions.readSet.set(context.solutionPath, original);
      }
    }
    const operations = [
      ...plan.records.map(record => ({kind: 'create', path: record.path, record: {...record}})),
      ...plan.folders.filter(path => !plan.records.some(record => record.path.startsWith(path + '/')) &&
        !current.folders.includes(path)).map(path => ({kind: 'mkdir', path})),
      ...modifications.map(record => ({kind: 'write', path: record.path, text: record.text}))
    ];
    try { await actions.perform(operations); }
    finally { actions.operationIdentity = null; actions.readSet = null; }
    if (!state.nativeMode && kind === 'project' && plan.entry && plan.entry !== state.projectSystem?.solution?.path) {
      await host.commit({records: host.context().records, folders: state.folders, entry: plan.entry,
        dirty: [...state.dirtyFiles], diskCommitted: !!state.disk?.rootHandle, preserveMembership: true});
    }
    if (plan.startup) {
      if (state.nativeMode) {
        host.nativeBuild.contexts.setProject(plan.startup);
        state.nativeStartup = plan.startup;
        host.nativeBuild.settings.project = plan.startup;
      }
      else if (!state.startupProject) state.startupProject = plan.startup;
    }
  }
  if (plan.openFile?.endsWith('.cs')) await host.open({kind: 'source', path: plan.openFile});
  host.render();
  host.save();
  host.log('Created ' + plan.records.length + ' files from ' + plan.template + '.');
  if (plan.profile === 'winui-web') host.layout('winui');
}
