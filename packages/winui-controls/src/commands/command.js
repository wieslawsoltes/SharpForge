import { ControlEvents, ControlError } from '../policy/events.js';

export class XamlUICommand extends ControlEvents {
  constructor({ execute = null, canExecute = () => true, label = '', description = '', iconSource = null } = {}) {
    super();
    this.executeHandler = execute;
    this.canExecuteHandler = canExecute;
    this.Label = label;
    this.Description = description;
    this.IconSource = iconSource;
    this.KeyboardAccelerators = [];
    this.AccessKey = '';
    this.executing = false;
  }

  canExecute(parameter) {
    const args = { Parameter: parameter, CanExecute: !this.executing && this.canExecuteHandler(parameter) !== false };
    this.emit('CanExecuteRequested', args);
    return args.CanExecute === true;
  }

  execute(parameter) {
    if (!this.canExecute(parameter)) return false;
    const args = this.emit('ExecuteRequested', { Parameter: parameter, Handled: false });
    if (!args.Handled && this.executeHandler) this.executeHandler(parameter);
    return true;
  }

  notifyCanExecuteChanged() { this.emit('CanExecuteChanged', {}); }
  *retainedValues() { yield this.IconSource; yield* this.KeyboardAccelerators; }
  snapshot() { return { version: 1, Label: this.Label, Description: this.Description, IconSource: this.IconSource,
    KeyboardAccelerators: [...this.KeyboardAccelerators], AccessKey: this.AccessKey }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1650', 'Invalid command snapshot');
    for (const key of ['Label', 'Description', 'IconSource', 'AccessKey']) this[key] = snapshot[key];
    this.KeyboardAccelerators = [...snapshot.KeyboardAccelerators]; this.executing = false;
  }
}

const standardSymbols = Object.freeze({ Cut: 0xe16b, Copy: 0xe16f, Paste: 0xe16d, SelectAll: 0xe14e, Delete: 0xe107,
  Share: 0xe72d, Save: 0xe105, Open: 0xe8e5, Close: 0xe10a, Pause: 0xe103, Play: 0xe102, Stop: 0xe15b,
  Forward: 0xe111, Backward: 0xe112, Undo: 0xe10e, Redo: 0xe10d, Refresh: 0xe149, Find: 0xe11a, New: 0xe109 });

const standardCommands = Object.freeze({
  None: ['', ''], Share: ['Share', ''], Pause: ['Pause', ''], Play: ['Play', ''], Forward: ['Forward', ''], Backward: ['Backward', ''],
  Cut: ['Cut', 'x'], Copy: ['Copy', 'c'], Paste: ['Paste', 'v'], SelectAll: ['Select all', 'a'],
  Delete: ['Delete', 'Delete'], Save: ['Save', 's'], Open: ['Open', 'o'], Undo: ['Undo', 'z'], Redo: ['Redo', 'y'],
  Refresh: ['Refresh', 'F5'], Stop: ['Stop', 'Escape'], Find: ['Find', 'f'], New: ['New', 'n'], Close: ['Close', 'w']
});

const standardKinds = ['None', 'Cut', 'Copy', 'Paste', 'SelectAll', 'Delete', 'Share', 'Save', 'Open', 'Close',
  'Pause', 'Play', 'Stop', 'Forward', 'Backward', 'Undo', 'Redo'];
export function standardCommandKind(value) { return typeof value === 'number' ? standardKinds[value] : value; }

export class StandardUICommand extends XamlUICommand {
  constructor(kind, options = {}) {
    const definition = standardCommands[kind];
    if (!definition) throw new ControlError('SFUI1650', 'Unknown standard command', { kind });
    super({ label: definition[0], ...options });
    this.Kind = kind;
    this.IconSource = Object.hasOwn(standardSymbols, kind) ? { Symbol: standardSymbols[kind] } : null;
    this.KeyboardAccelerators = definition[1] ? [{ Key: definition[1].length === 1 ? definition[1].toUpperCase().charCodeAt(0)
      : ({ Delete: 46, Escape: 27, F5: 116 }[definition[1]] ?? 0), Modifiers: definition[1].length === 1 ? 2 : 0, IsEnabled: true }] : [];
  }
}

export function commandCanExecute(context, node) {
  const command = node.properties.Command;
  if (!command) return true;
  const parameter = node.properties.CommandParameter;
  if (context.services?.commands?.canExecute) return context.services.commands.canExecute(command, parameter) !== false;
  if (typeof command.canExecute === 'function') return command.canExecute(parameter);
  if (typeof command.CanExecute === 'function') return command.CanExecute(parameter);
  const object = command.$ref ? context.nodes.get(command.$ref) : null;
  return object?.properties.CanExecuteResult !== false;
}

export function executeCommand(context, node) {
  const command = node.properties.Command;
  if (!command || !commandCanExecute(context, node)) return false;
  const parameter = node.properties.CommandParameter;
  if (context.services?.commands?.execute) return context.services.commands.execute(command, parameter);
  if (typeof command.execute === 'function') return command.execute(parameter);
  if (typeof command.Execute === 'function') return command.Execute(parameter);
  const object = command.$ref ? context.nodes.get(command.$ref) : null;
  if (!object) throw new ControlError('SFUI1651', 'The command has no executable adapter');
  context.emit(object, 'ExecuteRequested', { Parameter: parameter });
  return true;
}

/** Command presentation is inherited only when the control has no supplied label/icon. */
export function commandPresentation(context, node) {
  const command = node.properties.Command;
  const value = command?.$ref ? context.nodes.get(command.$ref)?.properties : command;
  return { label: node.properties.Label || value?.Label || '', icon: node.properties.Icon ?? value?.IconSource,
    description: value?.Description ?? '' };
}
