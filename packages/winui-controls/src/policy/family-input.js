import { applyNavigationInput } from '../navigation/pane-adapters.js';
import { managedTextModel, managedRichTextDocument } from '../text/adapters.js';
import { managedSelectionModel, synchronizeCurrentItem } from '../items/adapters.js';
import { applyTreeInput } from '../items/tree-input.js';
import { managedRange } from '../values/adapters.js';
import { applyValueInput } from '../values/input.js';
import { applyMediaInput } from '../media/player-adapters.js';
import { CONTROLS } from './adapter-helpers.js';

function quiet(model, emit, operation) {
  return emit ? operation() : model.silence(operation);
}

function writeText(context, receiver, model) {
  for (const [property, value] of [['Text', model.text], ['SelectionStart', model.selectionStart],
    ['SelectionLength', model.selectionLength], ['SelectedText', model.selectedText], ['CanUndo', model.canUndo], ['CanRedo', model.canRedo]]) {
    context.write(receiver, property, value);
  }
}

function textInput(context, receiver, event, payload, emit) {
  const model = managedTextModel(context, receiver);
  if (event === 'TextChanged') {
    const value = payload.Text ?? payload.value;
    if (typeof value !== 'string') return false;
    const options = { reason: 'user', selectionStart: payload.SelectionStart ?? model.selectionStart,
      selectionLength: payload.SelectionLength ?? 0 };
    quiet(model, emit, () => model.composition ? model.endComposition(value, { ...options, fullText: true }) : model.replace(value, options));
    payload.Text = payload.value = model.text;
  } else if (event === 'SelectionChanged') {
    if (!Number.isInteger(payload.SelectionStart)) return false;
    quiet(model, emit, () => model.select(payload.SelectionStart, payload.SelectionLength ?? 0));
  } else if (event === 'TextCompositionStarted') quiet(model, emit, () => model.beginComposition());
  else if (event === 'TextCompositionChanged') quiet(model, emit, () => model.updateComposition(payload.Text ?? ''));
  else if (event === 'TextCompositionEnded') {
    quiet(model, emit, () => model.endComposition(payload.Text ?? '', { cancelled: !!payload.Cancelled,
      fullText: payload.FullText !== false, selectionStart: payload.SelectionStart }));
  } else return false;
  writeText(context, receiver, model);
  return true;
}

function selectorInput(context, receiver, payload, emit) {
  const model = managedSelectionModel(context, receiver);
  const previousIndices = model.selectedIndices;
  const indices = payload.SelectedIndices;
  const ranges = payload.SelectedRanges;
  const index = payload.SelectedIndex ?? payload.value;
  if (!Array.isArray(indices) && !Array.isArray(ranges) && !Number.isInteger(index)) return false;
  quiet(model, emit, () => {
    if (Array.isArray(ranges)) {
      model.clear();
      for (const range of ranges) model.selectRange(range.FirstIndex, range.Length, true);
      if (index >= 0 && model.isSelected(index)) model.selectRange(index, 1, true);
    } else if (Array.isArray(indices)) model.setSelectedIndices(indices, index ?? indices[0] ?? -1);
    else model.select(index);
  });
  context.write(receiver, 'SelectedIndex', model.selectedIndex);
  context.write(receiver, 'SelectedItem', model.selectedItem);
  let selectedValue = model.selectedItem;
  const path = context.native(context.read(receiver, 'SelectedValuePath')) ?? '';
  for (const part of path ? path.split('.') : []) selectedValue = selectedValue == null ? null : context.read(selectedValue, part);
  context.write(receiver, 'SelectedValue', selectedValue);
  context.write(receiver, 'SelectedItems', context.collection(model.selectedItems, CONTROLS + 'ItemCollection'));
  context.write(receiver, 'SelectedRanges', model.selectedRanges.map(range => context.allocate(CONTROLS + 'ItemIndexRange', range)));
  synchronizeCurrentItem(model);
  payload.SelectedIndex = payload.value = model.selectedIndex;
  payload.SelectedIndices = model.selectedIndices;
  const previousSet = new Set(previousIndices);
  const currentSet = new Set(payload.SelectedIndices);
  payload.AddedItems = payload.SelectedIndices.filter(index => !previousSet.has(index)).map(index => model.getAt(index));
  payload.RemovedItems = previousIndices.filter(index => !currentSet.has(index)).map(index => model.getAt(index));
  return true;
}

/** Apply host input to the authoritative VM/JS model before dispatching its managed event. */
export function applyControlFamilyInput(context, receiver, event, payload, { emit = false, privateInput = false } = {}) {
  const type = context.typeOf(receiver).split('.').at(-1);
  if (applyNavigationInput(context, receiver, type, event, payload)) return true;
  if (type === 'CommandBar') {
    if (event === 'Opened' || event === 'Closed') { context.write(receiver, 'IsOpen', event === 'Opened'); return true; }
    if (event === 'DynamicOverflowItemsChanging' && Array.isArray(payload.Items)) {
      const ids = new Set(payload.Items.map(value => value?.$ref ?? context.id(value)));
      for (const item of context.items(context.read(receiver, 'PrimaryCommands'))) {
        if (ids.has(context.id(item))) context.write(item, 'IsInOverflow', payload.Action === 0);
      }
      return true;
    }
  }
  if (type === 'PasswordBox') {
    if (!privateInput) return false;
    const value = typeof payload === 'string' ? payload : payload.Password ?? payload.value;
    if (typeof value !== 'string') throw new TypeError('Private password input must be text');
    context.write(receiver, 'Password', value);
    return true;
  }
  if (['TextBox', 'AutoSuggestBox'].includes(type)) return textInput(context, receiver, event, payload, emit);
  if (type === 'RichEditBox' && event === 'TextChanged') {
    const model = managedRichTextDocument(context, receiver);
    const text = payload.RtfText ?? payload.Text ?? payload.value;
    if (typeof text !== 'string') return false;
    quiet(model, emit, () => model.setText(text, payload.RtfText == null ? 'text' : 'rtf'));
    context.write(receiver, 'Text', model.text);
    context.write(receiver, 'RtfText', model.getText('rtf'));
    return true;
  }
  if (type === 'TreeView') return applyTreeInput(context, receiver, event, payload, emit);
  if (['TextBlock', 'RichTextBlock', 'RichTextBlockOverflow'].includes(type)) {
    if (event === 'IsTextTrimmedChanged') { context.write(receiver, 'IsTextTrimmed', !!payload.IsTextTrimmed); return true; }
    if (event === 'SelectionChanged' && typeof payload.SelectedText === 'string') {
      context.write(receiver, 'SelectedText', payload.SelectedText);
      return true;
    }
  }
  if (event === 'SelectionChanged' && ['RadioButtons', 'SelectorBar', 'BreadcrumbBar'].includes(type)) {
    const index = payload.SelectedIndex ?? payload.value;
    if (!Number.isInteger(index)) return false;
    const source = context.read(receiver, 'ItemsSource') ?? context.read(receiver, 'Items');
    const items = context.items(source);
    const selected = index >= 0 && index < items.length ? index : -1;
    context.write(receiver, 'SelectedIndex', selected);
    context.write(receiver, 'SelectedItem', items[selected] ?? null);
    payload.SelectedIndex = payload.value = selected;
    payload.SelectedItem = items[selected] ?? null;
    return true;
  }
  if (type === 'PipsPager' && event === 'SelectedIndexChanged') {
    const count = Number(context.native(context.read(receiver, 'NumberOfPages')) ?? 0);
    const index = payload.SelectedIndex ?? payload.value;
    if (!Number.isInteger(index)) return false;
    const selected = count ? Math.max(0, Math.min(count - 1, index)) : -1;
    context.write(receiver, 'SelectedPageIndex', selected);
    payload.SelectedIndex = payload.value = selected;
    return true;
  }
  if (event === 'SelectionChanged' && ['ListView', 'ListBox', 'GridView', 'ItemsView', 'ComboBox', 'FlipView'].includes(type)) {
    return selectorInput(context, receiver, payload, emit);
  }
  if (event === 'ValueChanged' && ['NumberBox', 'Slider', 'ProgressBar', 'ProgressRing'].includes(type)) {
    const model = managedRange(context, receiver);
    quiet(model, emit, () => model.set(Number(payload.NewValue ?? payload.value)));
    context.write(receiver, 'Value', model.value);
    payload.NewValue = payload.value = model.value;
    return true;
  }
  if (['Checked', 'Unchecked', 'Indeterminate', 'IsCheckedChanged'].includes(event)) {
    const value = event === 'Indeterminate' ? null : event === 'Checked' ? true
      : event === 'Unchecked' ? false : payload.IsChecked ?? payload.value;
    context.write(receiver, 'IsChecked', value === true);
    if (!['ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem'].includes(type)) context.write(receiver, 'IsIndeterminate', value === null);
    payload.value = value;
    return true;
  }
  if (type === 'ToggleSwitch' && event === 'Toggled') {
    context.write(receiver, 'IsOn', !!(payload.IsOn ?? payload.value));
    return true;
  }
  if (event === 'GroupAnchorChanged') {
    context.write(receiver, 'GroupAnchor', payload.GroupAnchor);
    return true;
  }
  if (type === 'SemanticZoom' && event === 'ViewChangeCompleted') {
    context.write(receiver, 'IsZoomedInViewActive', !!payload.IsZoomedInViewActive);
    context.write(receiver, 'GroupAnchor', payload.DestinationItem);
    return true;
  }
  return applyValueInput(context, receiver, type, event, payload, emit) || applyMediaInput(context, receiver, type, event, payload);
}
