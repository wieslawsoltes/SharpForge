/** Compose context menus from current selection; commands recheck all guards when invoked. */
export function buildExplorerMenu(commands, node, selection = []) {
  const nodes = commands.nodes(node, selection);
  const files = commands.files(nodes);
  const single = nodes.length === 1;
  const context = commands.context();
  const canChange = () => commands.editable();
  const canChangeFiles = () => commands.editable() === true && files.length === nodes.length && files.length > 0;
  const action = (label, id, shortcut = '', enabled = true) =>
    ({label, shortcut, enabled, action: () => commands.run(id, node, nodes)});
  const items = [];
  if (single && ['source', 'file', 'assembly', 'project-file', 'generated', 'project-reference', 'symbol', 'import'].includes(node?.kind)) {
    items.push(action(node.kind === 'assembly' ? 'Open in Decompiler' : 'Open', 'open', 'Enter'));
  }
  if (node?.kind === 'source') items.push(action('Open in New Vertical Tab Group', 'split'), action('Open in Separate Window', 'popout'));
  if (node?.kind === 'project' || node?.kind === 'solution') {
    const nativeReady = () => !context.native || context.nativeAvailable && context.trusted && !context.buildBusy ? true :
      'Connect an available MSBuild engine and explicitly trust this workspace';
    items.push(action('Build', 'build', 'Ctrl+Shift+B', nativeReady), action('Rebuild', 'rebuild', '', nativeReady),
      action('Clean', 'clean', '', nativeReady));
    if (context.native) items.push(action('Restore Packages', 'restore', '', nativeReady), action('Evaluate Project', 'evaluate', '', nativeReady));
    if (node.kind === 'project') items.push(action('Set as Startup Project', 'startup', '', canChange),
      action('Edit Project File', 'edit-project', '', !!node.path), action('Rename Project…', 'rename', 'F2', canChange));
    else if (node.path) items.push(action('Edit Solution File', 'open'));
    items.push(null);
  }
  if (['solution', 'project', 'workspace', 'folder', 'solution-folder'].includes(node?.kind)) {
    const canSolution = () => commands.context().solutionPath ? canChange() : 'Open a .slnx solution first';
    items.push({label: 'Add', enabled: canChange, children: [
      action('New Item…', 'new-file', 'Ctrl+Shift+A', canChange),
      action('Existing Item…', 'add-existing', 'Shift+Alt+A', canChange),
      action('Existing Item as Link…', 'add-link', '', () => node.project ? canChange() : 'Select a project folder'),
      action('New Folder…', 'new-folder', '', canChange), null,
      action('New Project…', 'new-project', '', canChange), action('Existing Project…', 'add-project', '', canSolution),
      action('Solution Folder…', 'solution-folder', '', canSolution)
    ]});
  }
  if (['dependencies', 'project', 'dependency-group'].includes(node?.kind)) {
    const hasProject = () => node.project ? canChange() : 'Open an SDK project first';
    items.push(action('Add Project Reference…', 'add-reference', '', hasProject), action('Add Package Reference…', 'add-package', '', hasProject));
  }
  if (node?.kind === 'project' && node.path && context.solutionPath) {
    items.push(action('Move to Solution Folder…', 'project-folder', '', canChange), action('Remove from Solution…', 'remove-project', '', canChange));
  }
  if (node?.kind === 'solution-folder' && node.solutionFolder) {
    items.push(action('Rename Solution Folder…', 'rename-solution-folder', 'F2', canChange),
      action('Remove Solution Folder…', 'remove-solution-folder', 'Delete', canChange));
  }
  if (['project-reference', 'package', 'reference', 'analyzer'].includes(node?.kind)) {
    items.push(action('Remove Reference…', 'remove-reference', 'Delete', canChange));
  }
  const canPaste = () => commands.clipboard ? canChange() : 'Copy or cut an explorer item first';
  if (files.length) {
    items.push(null, action('Cut', 'cut', 'Ctrl+X', canChangeFiles), action('Copy', 'copy', 'Ctrl+C'),
      action('Paste', 'paste', 'Ctrl+V', canPaste), null, action('Rename…', 'rename', 'F2', () => single && canChangeFiles()),
      action('Delete…', 'delete', 'Delete', canChangeFiles));
    if (nodes.every(file => file.project && ['source', 'file'].includes(file.kind))) {
      items.push(action('Include in Project', 'include', '', canChange), action('Exclude from Project', 'exclude', '', canChange),
        {label: 'Build Action', enabled: canChange, children: ['Compile', 'None', 'Content', 'EmbeddedResource', 'AdditionalFiles']
          .map(kind => action(kind, 'build-action:' + kind, '', canChange))});
    }
  } else items.push(action('Paste', 'paste', 'Ctrl+V', canPaste));
  if (node?.branch) items.push(null, action('Scope to This', 'scope'), action('Expand All', 'expand'), action('Collapse', 'collapse'));
  items.push(null, action('Undo Last File Operation', 'undo', 'Ctrl+Z',
    () => commands.history.length ? canChange() : 'No file operation to undo in this workspace session'),
  action('Redo Last File Operation', 'redo', 'Ctrl+Shift+Z',
    () => commands.fileHistory?.canRedo ? canChange() : 'No file operation to redo'),
  action('Sync with Active Document', 'sync'), action('Refresh', 'refresh'), null,
  action('Copy Full Path', 'copy-path', '', !!node?.path), action('Copy Relative Path', 'copy-relative', '', !!node?.path),
  action('Properties', 'properties', 'Alt+Enter'));
  if (['workspace', 'solution', 'project'].includes(node?.kind) && commands.host.workspaceAction) {
    items.push(null, action('Save Workspace as ZIP…', 'save-zip'), action('Save Workspace to Empty Folder…', 'save-folder'));
  }
  if (node?.path && /\.(csproj|slnx|sln)$/i.test(node.path) && commands.host.workspaceAction) {
    items.push(action('Open as Workspace Entry', 'open-workspace-entry'));
  }
  if (node?.path && /\.sln$/i.test(node.path) && commands.host.workspaceAction) {
    items.push(action('Convert to SLNX (keep original)…', 'convert-sln', '', canChange));
  }
  if (commands.host.windowMenu) items.push(null, {label: 'Window', children: () => commands.host.windowMenu()});
  if (commands.host.explorer?.persistence) {
    items.push(null, action('Restore Workspace Recovery…', 'restore-recovery', '', canChange));
    items.push(action('Reopen Recent Folder…', 'recent-workspaces', '', canChange),
      action('Keep Recovery Storage…', 'persist-recovery'));
    if (node?.path && commands.host.explorer.persistence.conflicts?.conflicts.has(node.path)) {
      items.push(action('Resolve Document Conflict…', 'resolve-conflict', '', canChange));
    }
  }
  return items;
}
