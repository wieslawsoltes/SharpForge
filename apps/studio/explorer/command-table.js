import {projectContextActions} from '../workbench/startup-commands.js';
import {registerClipboardCommands} from './clipboard.js';
import {registerCreateCommands} from './create.js';
import {registerDeleteCommands} from './delete.js';
import {registerMembershipCommands} from './membership.js';
import {registerReferenceCommands} from './references.js';
import {registerRenameCommands} from './rename.js';
import {registerSolutionCommands} from './solution.js';
import {diffWorkspaceStates} from '@sharpforge/workspace';
import {captureExplorerState} from './operation-history.js';

/** Each operation registers once; UI menus, shortcuts and drops share the same admission and command boundary. */
export function createExplorerCommandTable() {
  const registry = new Map();
  for (const register of [registerClipboardCommands, registerCreateCommands, registerDeleteCommands,
    registerMembershipCommands, registerReferenceCommands, registerRenameCommands, registerSolutionCommands]) register(registry);
  const readOnly = {
    open: ({commands, node}) => node && commands.host.open(node),
    properties: ({commands, nodes}) => commands.host.properties(nodes),
    sync: ({commands, context}) => commands.host.explorer.reveal(context.active, true),
    scope: ({commands, node}) => commands.host.explorer.scopeTo(node),
    expand: ({commands, node}) => commands.host.explorer.model.expandAll(true, node.id),
    collapse: ({commands, node}) => commands.host.explorer.model.expandAll(false, node.id),
    refresh: ({commands}) => commands.host.refresh()
  };
  for (const [id, execute] of Object.entries(readOnly)) registry.set(id, {mutates: false, execute});
  for (const action of ['copy-path', 'copy-relative']) registry.set(action, {mutates: false, execute: ({commands, context, nodes}) =>
    commands.host.copy(nodes.map(node => (action === 'copy-path' && context.root ? context.root.replace(/\/$/, '') + '/' : '') +
      (node.path ?? node.label)).join('\n'))});
  for (const action of ['split', 'popout']) registry.set(action, {mutates: false, execute: async ({commands, node}) => {
    await commands.host.open(node);
    return commands.host.document(action, node.path);
  }});
  for (const action of projectContextActions) {
    registry.set(action, {mutates: false, execute: ({commands, node}) => commands.host.project(action, node)});
  }
  for (const action of ['save-zip', 'save-folder', 'open-workspace-entry', 'convert-sln']) {
    registry.set(action, {mutates: true, execute: ({commands, node}) => {
      if (!commands.host.workspaceAction) throw new Error('Workspace action is unavailable: ' + action);
      return commands.host.workspaceAction(action, node);
    }});
  }
  for (const action of ['disk-external-change', 'disk-reevaluate']) {
    registry.set(action, {mutates: false, execute: ({commands, node, event}) => {
      if (!commands.host.workspaceAction) throw new Error('Disk workspace updates are unavailable in this host');
      return commands.host.workspaceAction(action, node, event);
    }});
  }
  registry.set('undo', {mutates: true, execute: ({commands}) => commands.undo()});
  registry.set('redo', {mutates: true, execute: ({commands}) => commands.redo()});
  registry.set('restore-recovery', {mutates: true, execute: async ({commands}) => {
    const records = await commands.host.explorer.persistence.recent();
    if (!records.length) throw new Error('No recovery checkpoint is available for this workspace');
    const labels = records.map((record, index) => `${index + 1}. ${record.name} — ${new Date(record.savedAt).toLocaleString()}`);
    const selected = await commands.host.choose('Restore Workspace Recovery', labels);
    if (!selected) return;
    const record = records[labels.indexOf(selected)];
    if (!record || !await commands.host.confirm('Restore Recovery', record.records.map(file => file.path),
      'Replace the current buffers with this checkpoint. Export current work first if it must be kept separately.')) return;
    const before = captureExplorerState(commands.context());
    const target = {...before, ...record, tabs: record.openDocuments.map(document => document.path)};
    const operations = await diffWorkspaceStates(before, target);
    await commands.fileHistory.execute(operations, {targetState: target, label: 'Restore recovery'});
    commands.history = commands.fileHistory.undoStack;
  }});
  registry.set('resolve-conflict', {mutates: true, execute: async ({commands, node}) => {
    await commands.host.explorer.persistence.prepareConflict(node.path);
    const choices = ['adopt-newer', 'keep-mine', 'merge'];
    const choice = await commands.host.choose('Resolve Document Conflict', choices);
    if (choice) return commands.host.explorer.persistence.resolve(node.path, choice);
  }});
  registry.set('recent-workspaces', {mutates: true, execute: async ({commands}) => {
    const persistence = commands.host.explorer.persistence;
    const records = await persistence.recentFolders();
    if (!records.length) throw new Error('No recent folders are available. Open a directory first.');
    const labels = records.map((record, index) => `${index + 1}. ${record.name}`);
    const selected = await commands.host.choose('Reopen Recent Folder', labels);
    if (!selected) return;
    const recent = await persistence.reopenRecent(records[labels.indexOf(selected)].identity);
    if (!commands.host.workspaceAction) throw new Error('Recent folder reopening is unavailable in this host');
    return commands.host.workspaceAction('reopen-recent-workspace', {recent});
  }});
  registry.set('persist-recovery', {mutates: false, execute: async ({commands}) => {
    const result = await commands.host.explorer.persistence.requestPersistence();
    commands.host.notice(result.persistent ? 'Recovery storage persistence was granted.' :
      'Recovery storage persistence was not granted. Export a copy to keep the workspace outside browser storage.');
    return result;
  }});
  registry.set('apply-conflict-resolution', {mutates: false, execute: async ({commands, event}) => {
    if (commands.editable() !== true) throw new Error(commands.editable());
    if (!commands.host.applyConflictResolution) throw new Error('Peer buffer resolution is unavailable in this host');
    return commands.host.applyConflictResolution(event.resolution);
  }});
  return registry;
}
