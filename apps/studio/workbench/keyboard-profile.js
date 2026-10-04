import {getProfileBindings} from '@sharpforge/editor';

// Workspace command identities stay in the app; the editor package owns only editor command identities.
const workspaceCommands = Object.freeze({
  'Edit.NavigateTo': 'workbench.goToAll', 'Edit.GotoAll': 'workbench.goToAll',
  'Edit.FindinFiles': 'findFiles', 'Edit.ReplaceinFiles': 'workbench.replaceFiles',
  'View.CommandPalette': 'commands', 'View.Settings': 'workbench.options', 'View.KeyboardSettings': 'workbench.keyboard',
  'View.NavigateBackward': 'navigateBack', 'View.NavigateForward': 'navigateForward',
  'File.SaveSelectedItems': 'save', 'File.SaveAll': 'document.saveAll', 'File.NewFile': 'new',
  'Build.BuildSolution': 'build', 'Debug.Start': 'debug', 'Debug.StartWithoutDebugging': 'run',
  'Debug.StopDebugging': 'stop', 'Debug.Restart': 'restart', 'Debug.StepOver': 'next',
  'Debug.StepInto': 'stepIn', 'Debug.StepOut': 'stepOut', 'Debug.RunToCursor': 'runToCursor'
});

/** Project only registered workspace actions into global scope; editing shortcuts remain editor-local. */
export function workbenchProfileBindings(profile, commands) {
  return getProfileBindings(profile).flatMap((binding, index) => {
    const command = workspaceCommands[binding.command];
    if (!command || !commands.describe(command)) return [];
    return [{...binding, id: `workspace-profile:${profile}:${index}`, command, scope: 'Global',
      priority: 20 + (binding.priority ?? 0)}];
  });
}
