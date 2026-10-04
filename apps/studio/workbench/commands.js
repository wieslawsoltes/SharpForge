import {compileWhen} from './context-keys.js';

export const commandAliases = Object.freeze({
  'Debug.Start': 'debug', 'Debug.StartWithoutDebugging': 'run', 'Debug.StopDebugging': 'stop',
  'Debug.StepOver': 'next', 'Debug.StepInto': 'stepIn', 'Debug.StepOut': 'stepOut',
  'Build.BuildSolution': 'build', 'File.SaveAll': 'document.saveAll', 'File.OpenFile': 'open',
  'Edit.Find': 'find', 'Edit.FindInFiles': 'findFiles', 'Tools.Options': 'workbench.options',
  'View.ErrorList': 'tool:problems', 'View.Output': 'tool:output',
  'View.CommandWindow': 'tool:command-window', 'Window.CloseAllDocuments': 'window.closeAllDocuments'
});

const policy = Object.freeze({
  pause: 'debugState == running', next: 'debugState == paused', stepIn: 'debugState == paused',
  stepOut: 'debugState == paused', setNext: 'debugState == paused && activeDocumentKind == code',
  stop: 'sessionCount || debugState == running || debugState == paused',
  rename: 'activeDocumentKind == code && !readOnly',
  undo: 'activeDocumentKind && !readOnly', redo: 'activeDocumentKind && !readOnly',
  definition: 'activeDocumentKind == code', references: 'activeDocumentKind == code'
});

/** Register contributions through the shared registry; removal restores any replaced legacy handler. */
export function contributeCommands(registry, commands) {
  const removals = [];
  try {
    for (const command of commands) {
      const descriptor = {...command, label: command.title ?? command.label};
      const when = command.when ? compileWhen(command.when) : null;
      if (when) {
        descriptor.enabled = context => when(context) &&
          (typeof command.enabled === 'function' ? command.enabled(context) : command.enabled !== false);
      }
      if (registry.describe(command.id)) {
        const changes = {execute: descriptor.execute, label: descriptor.label};
        for (const key of ['enabled', 'checked', 'shortcut', 'category']) {
          if (descriptor[key] !== undefined) changes[key] = descriptor[key];
        }
        removals.push(registry.configure(command.id, changes));
      } else removals.push(registry.register(descriptor));
    }
  } catch (error) {
    for (const remove of removals.reverse()) remove();
    throw error;
  }
  return () => { for (const remove of removals.reverse()) remove(); };
}

export function installCommandContext(registry, keys, extra = () => ({})) {
  registry.setContext(() => ({...keys.snapshot(), ...extra()}));
  const removals = [];
  for (const [id, expression] of Object.entries(policy)) {
    if (registry.describe(id)) removals.push(registry.configure(id, {enabled: compileWhen(expression)}));
  }
  const unsubscribe = keys.subscribe(() => registry.invalidate());
  return () => { unsubscribe(); for (const remove of removals.reverse()) remove(); };
}

export function commandInventory(registry) {
  return registry.search().map(command => ({
    id: command.id, title: command.label, category: command.category ?? 'General',
    shortcut: command.shortcut ?? '', status: 'implemented',
    qualification: 'Registered handler; see workflow matrix for behavior and platform qualification'
  })).sort((left, right) => left.id.localeCompare(right.id));
}
