import { getControlFamilyModel, invokeManagedButton } from '../policy/adapters.js';
import { nextToggleValue } from '../buttons/index.js';
import { read } from '../policy/adapter-helpers.js';

const typeOf = (context, owner) => context.typeOf(owner).split('.').at(-1);
const family = (context, owner, kind) => getControlFamilyModel(context, owner, kind);

function setChecked(context, owner, checked) {
  const result = context.registry.invoke(context, { owner: context.typeOf(owner), kind: 'set', name: 'set_IsChecked', property: 'IsChecked' },
    owner, [context.managed(checked, 'bool')]);
  if (!result.handled) throw new Error('SFAX015: This element does not implement checked-state changes');
}
function toggle(context, owner) {
  if (typeOf(context, owner) === 'ToggleSwitch') {
    const value = !read(context, owner, 'IsOn', false);
    context.write(owner, 'IsOn', value); context.emit(owner, 'Toggled', { IsOn: value }); return;
  }
  const previous = read(context, owner, 'IsIndeterminate', false) ? null : read(context, owner, 'IsChecked', false);
  setChecked(context, owner, nextToggleValue(previous, read(context, owner, 'IsThreeState', false)));
}
function setValue(context, owner, value) {
  const type = typeOf(context, owner);
  if (type === 'PasswordBox') throw new Error('SFAX005: Password values are private');
  if (read(context, owner, 'IsReadOnly', false)) throw new Error('SFAX004: Automation value is read-only');
  if (typeof value === 'number') { family(context, owner, 'range').set(value); return; }
  if (type === 'RichEditBox') { family(context, owner, 'richText').setText(value, 'text'); return; }
  if (['TextBox', 'AutoSuggestBox'].includes(type)) { family(context, owner, 'text').replace(value); return; }
  if (type === 'ComboBox' && read(context, owner, 'IsEditable', false)) { context.write(owner, 'Text', value); return; }
  const method = type === 'TimePicker' ? 'SetTime' : ['DatePicker', 'CalendarDatePicker'].includes(type) ? 'SetDate' : null;
  if (method) {
    const result = context.registry.invoke(context, { owner: context.typeOf(owner), kind: 'method', name: method }, owner,
      [context.managed(value, 'string')]);
    if (result.handled) return result.value;
  }
  throw new Error('SFAX015: This control has no text-value setter');
}
function expand(context, owner, expanded) {
  const type = typeOf(context, owner);
  const property = ['ComboBox', 'DatePicker', 'TimePicker', 'CalendarDatePicker'].includes(type) ? 'IsDropDownOpen'
    : type === 'AutoSuggestBox' ? 'IsSuggestionListOpen' : 'IsExpanded';
  if (read(context, owner, property, false) === expanded) return;
  if (type === 'Expander') context.emit(owner, expanded ? 'Expanding' : 'Collapsing', {});
  context.write(owner, property, expanded);
  if (type === 'Expander') context.emit(owner, expanded ? 'Expanded' : 'Collapsed', {});
}
function selection(context, owner, method, args) {
  if (['RadioButton', 'ListViewItem', 'GridViewItem', 'ListBoxItem', 'TabViewItem', 'SelectorItem'].includes(typeOf(context, owner))) {
    if (typeOf(context, owner) === 'RadioButton') { setChecked(context, owner, method !== 'RemoveFromSelection'); return; }
    context.write(owner, 'IsSelected', method !== 'RemoveFromSelection');
    return;
  }
  const model = family(context, owner, 'selection');
  const index = Number(args[0]);
  if (method === 'Select') return model.select(index);
  if (method === 'AddToSelection') return model.selectRange(index, 1, true);
  if (method === 'RemoveFromSelection') return model.selectRange(index, 1, false);
  if (method === 'SelectAll') return model.selectAll();
  return model.clear();
}

/** UIA actions execute the same authoritative models as ordinary managed control members. */
export function invokeManagedAutomationAction(context, owner, method, args = [], { layout, requestHost } = {}) {
  if (!read(context, owner, 'IsEnabled', true)) throw new Error('SFAX003: Automation action targets a disabled control');
  if (method === 'Invoke') return invokeManagedButton(context, owner);
  if (method === 'Toggle') return toggle(context, owner);
  if (method === 'SetValue') return setValue(context, owner, args[0]);
  if (method === 'SelectText') {
    return family(context, owner, typeOf(context, owner) === 'RichEditBox' ? 'richText' : 'text').select(args[0], args[1]);
  }
  if (['Select', 'AddToSelection', 'RemoveFromSelection', 'SelectAll', 'DeselectAll'].includes(method)) {
    return selection(context, owner, method, args);
  }
  if (method === 'Expand' || method === 'Collapse') return expand(context, owner, method === 'Expand');
  if (['ChangeView', 'ScrollTo', 'ScrollBy', 'ZoomTo', 'Focus'].includes(method)) return layout.invoke(owner, method, args);
  if (['Scroll', 'SetScrollPercent', 'ScrollIntoView'].includes(method)) {
    if (!requestHost) throw new Error('SFAX017: Realized-item scrolling requires a browser layout host');
    const result = requestHost(owner, method, args);
    if (result?.then) context.task(result, { resultType: 'void', roots: [owner] });
    return null;
  }
  throw new Error('SFAX015: Unsupported managed automation action: ' + method);
}
