import { XamlUICommand, StandardUICommand, standardCommandKind } from './command.js';
import { RefreshController } from './swipe-refresh.js';
import { nextToggleValue } from '../buttons/index.js';
import { XAML as X, CONTROLS as C, read, registerMethod, registerGet, registerSet } from '../policy/adapter-helpers.js';
import { ControlError } from '../policy/events.js';

const input = X + 'Input.';

export function managedCommand(context, receiver) {
  return context.state(receiver, 'family.command', () => {
    const standard = context.typeOf(receiver)?.endsWith('StandardUICommand');
    const model = standard ? new StandardUICommand(standardCommandKind(read(context, receiver, 'Kind', 0))) : new XamlUICommand();
    for (const name of ['CanExecuteRequested', 'ExecuteRequested', 'CanExecuteChanged']) {
      model.on(name, args => context.emit(receiver, name, args));
    }
    return model;
  });
}

export function invokeManagedCommand(context, command, parameter) {
  if (!command || context.native(command) == null) return false;
  const enabled = context.native(context.invokeVirtual(command, 'CanExecute', [parameter]));
  if (!enabled) return false;
  context.invokeVirtual(command, 'Execute', [parameter]); return true;
}

export function invokeManagedButton(context, receiver) {
  if (!read(context, receiver, 'IsEnabled', true)) return false;
  const command = context.read(receiver, 'Command');
  if (context.native(command) != null && !invokeManagedCommand(context, command, context.read(receiver, 'CommandParameter'))) return false;
  context.emit(receiver, 'Click', {});
  return true;
}

function setChecked(context, receiver, value) {
  const checked = value !== undefined && context.properties?.toNative
    ? context.properties.toNative(value, 'bool') : context.native(value);
  if (checked !== null && typeof checked !== 'boolean') throw new ControlError('SFUI1640', 'Checked state must be true, false or null');
  // The explicit indeterminate flag preserves the released bool property's signature.
  const previous = read(context, receiver, 'IsIndeterminate', false) ? null : read(context, receiver, 'IsChecked', false);
  context.write(receiver, 'IsChecked', checked === true);
  context.write(receiver, 'IsIndeterminate', checked === null);
  if (previous !== checked) context.emit(receiver, checked === null ? 'Indeterminate' : checked ? 'Checked' : 'Unchecked', { IsChecked: checked });
}

export function registerCommandAdapters(registry) {
  for (const owner of [input + 'XamlUICommand', input + 'StandardUICommand']) {
    registerMethod(registry, owner, 'CanExecute', (c, r, args) => c.managed(managedCommand(c, r).canExecute(args[0]), 'bool'));
    registerMethod(registry, owner, 'Execute', (c, r, args) => { managedCommand(c, r).execute(args[0]); });
    registerMethod(registry, owner, 'NotifyCanExecuteChanged', (c, r) => managedCommand(c, r).notifyCanExecuteChanged());
  }
  registerMethod(registry, input + 'StandardUICommand', '.ctor', (c, r, args) => {
    const kind = Number(c.native(args[0] ?? 0)), model = new StandardUICommand(standardCommandKind(kind));
    const receiver = c.allocate(input + 'StandardUICommand', { Kind: kind, Label: model.Label, Description: model.Description });
    c.write(receiver, 'IconSource', model.IconSource ? c.allocate(C + 'SymbolIconSource', model.IconSource) : null);
    const accelerators = model.KeyboardAccelerators.map(item => c.allocate(input + 'KeyboardAccelerator', item));
    c.write(receiver, 'KeyboardAccelerators', c.collection(accelerators, C + 'ItemCollection'));
    return receiver;
  }, { kind: 'constructor' });
  registerSet(registry, input + 'StandardUICommand', 'Kind', (c, r, value) => {
    const model = new StandardUICommand(standardCommandKind(Number(c.native(value))));
    c.write(r, 'Kind', value); c.write(r, 'Label', model.Label);
    c.write(r, 'IconSource', model.IconSource ? c.allocate(C + 'SymbolIconSource', model.IconSource) : null);
    const current = managedCommand(c, r);
    current.Kind = model.Kind;
    current.Label = model.Label;
    current.IconSource = c.read(r, 'IconSource');
    current.KeyboardAccelerators = model.KeyboardAccelerators;
    c.write(r, 'KeyboardAccelerators', c.collection(model.KeyboardAccelerators.map(item =>
      c.allocate(input + 'KeyboardAccelerator', item)), C + 'ItemCollection'));
  });
  for (const name of ['Button', 'ToggleButton', 'CheckBox', 'RadioButton', 'HyperlinkButton', 'RepeatButton',
    'DropDownButton', 'SplitButton', 'ToggleSplitButton', 'AppBarButton', 'AppBarToggleButton']) {
    registerMethod(registry, C + name, 'Invoke', (context, receiver) => { invokeManagedButton(context, receiver); });
  }
  for (const name of ['ToggleButton', 'CheckBox', 'RadioButton', 'ToggleSplitButton', 'AppBarToggleButton']) {
    registerMethod(registry, C + name, 'SetChecked', (c, r, args) => setChecked(c, r, args[0]));
    registerSet(registry, C + name, 'IsChecked', setChecked);
    registerMethod(registry, C + name, 'GetChecked', (c, r) => c.managed(read(c, r, 'IsIndeterminate', false)
      ? null : read(c, r, 'IsChecked', false), 'object'));
  }
  registerMethod(registry, C + 'RefreshContainer', 'RequestRefreshAsync', (c, r) => {
    const model = c.state(r, 'family.refresh', () => {
      const value = new RefreshController(); value.on('RefreshRequested', args => c.emit(r, 'RefreshRequested', args));
      value.on('StateChanged', args => c.write(r, 'IsRefreshing', args.State === 'Refreshing')); return value;
    });
    return c.task(model.request(), { resultType: 'void' });
  });
  registerMethod(registry, C + 'SwipeControl', 'Close', (c, r) => c.write(r, 'IsOpen', false));
}
