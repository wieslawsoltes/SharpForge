import { AutomationControlType as Type, PatternInterface as Pattern, AccessibilityView } from './enums.js';
import { automationElementId, automationReferences, getAutomationProperty, hasAutomationProperty } from './automation-properties.js';

export const automationRoles = Object.freeze({
  [Type.Button]: 'button', [Type.Calendar]: 'grid', [Type.CheckBox]: 'checkbox', [Type.ComboBox]: 'combobox',
  [Type.Edit]: 'textbox', [Type.Hyperlink]: 'link', [Type.Image]: 'img', [Type.ListItem]: 'listitem', [Type.List]: 'list',
  [Type.Menu]: 'menu', [Type.MenuBar]: 'menubar', [Type.MenuItem]: 'menuitem', [Type.ProgressBar]: 'progressbar',
  [Type.RadioButton]: 'radio', [Type.ScrollBar]: 'scrollbar', [Type.Slider]: 'slider', [Type.Spinner]: 'spinbutton',
  [Type.StatusBar]: 'status', [Type.Tab]: 'tablist', [Type.TabItem]: 'tab', [Type.ToolBar]: 'toolbar', [Type.ToolTip]: 'tooltip',
  [Type.Tree]: 'tree', [Type.TreeItem]: 'treeitem', [Type.Group]: 'group', [Type.DataGrid]: 'grid', [Type.DataItem]: 'row',
  [Type.Document]: 'document', [Type.SplitButton]: 'button', [Type.Window]: 'group', [Type.Header]: 'row',
  [Type.HeaderItem]: 'columnheader', [Type.Table]: 'table', [Type.Separator]: 'separator', [Type.AppBar]: 'toolbar'
});

const landmarks = [null, 'region', 'form', 'main', 'navigation', 'search'];
const innerParts = '[data-part="text-editor"], [data-part="toggle-input"], [data-part="number-input"]';
const nativeInteractive = 'input,textarea,select,button,a[href]';

export function automationRole(peer) {
  const owner = peer.Owner;
  if (getAutomationProperty(owner, 'AccessibilityView') === AccessibilityView.Raw) return 'presentation';
  if (getAutomationProperty(owner, 'HeadingLevel')) return 'heading';
  const landmark = getAutomationProperty(owner, 'LandmarkType');
  return landmarks[landmark] ?? peer.definition?.role ?? automationRoles[peer.GetAutomationControlType()] ?? null;
}

function relations(peer, tree, property) {
  return automationReferences(getAutomationProperty(peer.Owner, property)).filter(id => tree.host.nodes.has(id))
    .map(id => automationElementId(tree.host.rootKey, id)).join(' ');
}

/** The same semantic attributes are used for retained DOM controls and GPU proxies. */
export function automationAttributes(peer, tree) {
  const node = peer.Owner;
  const properties = node.properties;
  const attrs = { id: automationElementId(tree.host.rootKey, peer.id), role: automationRole(peer) };
  const name = peer.GetName();
  const labelledBy = relations(peer, tree, 'LabeledBy');
  if (labelledBy && !hasAutomationProperty(node, 'Name')) attrs['aria-labelledby'] = labelledBy;
  else if (name) attrs['aria-label'] = name;
  const describedBy = relations(peer, tree, 'DescribedBy');
  if (describedBy) attrs['aria-describedby'] = describedBy;
  const description = [getAutomationProperty(node, 'HelpText'), getAutomationProperty(node, 'FullDescription'),
    getAutomationProperty(node, 'ItemStatus')].filter(Boolean).join('. ');
  if (description) attrs['aria-description'] = description;
  if (getAutomationProperty(node, 'AutomationId')) attrs['data-automation-id'] = getAutomationProperty(node, 'AutomationId');
  if (hasAutomationProperty(node, 'LiveSetting')) attrs['aria-live'] = ['off', 'polite', 'assertive'][getAutomationProperty(node, 'LiveSetting')];
  const level = getAutomationProperty(node, 'HeadingLevel');
  if (level) attrs['aria-level'] = level;
  for (const [property, attribute] of [['PositionInSet', 'aria-posinset'], ['SizeOfSet', 'aria-setsize']]) {
    const value = getAutomationProperty(node, property);
    if (value >= 1 || property === 'SizeOfSet' && value === -1 && hasAutomationProperty(node, property)) attrs[attribute] = value;
  }
  if (getAutomationProperty(node, 'IsRequiredForForm')) attrs['aria-required'] = 'true';
  if (getAutomationProperty(node, 'LocalizedLandmarkType')) attrs['aria-roledescription'] = getAutomationProperty(node, 'LocalizedLandmarkType');
  if (!peer.IsEnabled()) attrs['aria-disabled'] = 'true';
  if (tree.isHidden(peer.ownerId ?? peer.id)) attrs['aria-hidden'] = 'true';
  if (peer.definition?.modal) attrs['aria-modal'] = 'true';
  if (peer.definition?.popup) attrs['aria-haspopup'] = peer.definition.popup;
  if (properties.IsReadOnly) attrs['aria-readonly'] = 'true';
  if (properties.AcceptsReturn) attrs['aria-multiline'] = 'true';
  patternAttributes(peer, attrs);
  return attrs;
}

function patternAttributes(peer, attrs) {
  const properties = peer.properties;
  const toggle = peer.GetPattern(Pattern.Toggle);
  if (toggle) attrs[attrs.role === 'button' ? 'aria-pressed' : 'aria-checked'] = ['false', 'true', 'mixed'][toggle.ToggleState];
  const selection = peer.GetPattern(Pattern.SelectionItem);
  if (selection) attrs[attrs.role === 'radio' ? 'aria-checked' : 'aria-selected'] = String(selection.IsSelected);
  const selectable = peer.GetPattern(Pattern.Selection);
  if (selectable && ['listbox', 'tree', 'grid', 'tablist'].includes(attrs.role)) attrs['aria-multiselectable'] = String(selectable.CanSelectMultiple);
  const expanded = peer.GetPattern(Pattern.ExpandCollapse);
  if (expanded && expanded.ExpandCollapseState !== 3) attrs['aria-expanded'] = String(expanded.ExpandCollapseState === 1);
  const range = peer.GetPattern(Pattern.RangeValue);
  if (range && !properties.IsIndeterminate) {
    attrs['aria-valuemin'] = range.Minimum;
    attrs['aria-valuemax'] = range.Maximum;
    attrs['aria-valuenow'] = range.Value;
    if (properties.ValueText) attrs['aria-valuetext'] = properties.ValueText;
  }
  if (['slider', 'scrollbar'].includes(attrs.role)) attrs['aria-orientation'] = properties.Orientation === 0 ? 'vertical' : 'horizontal';
}

/** Owns only assigned attributes. Renderer/native labels survive unless an explicit automation name replaces them. */
export class AriaBridge {
  constructor(tree) { this.tree = tree; this.assigned = new Map(); this.targets = new Map(); }
  targetFor(element) {
    if (!element) return null;
    return element.matches?.(nativeInteractive) ? element : element.querySelector?.(innerParts) ?? element;
  }
  apply(peer, element, { proxy = false } = {}) {
    const descriptor = this.tree.host.registry?.resolve(peer.Owner.type);
    const semantic = descriptor?.automationElement?.(this.tree.host.context, peer.Owner, element);
    const target = proxy ? element : this.targetFor(semantic ?? element);
    if (!target) return null;
    const previousTarget = this.targets.get(element);
    if (previousTarget && previousTarget !== target) this.assigned.delete(previousTarget);
    this.targets.set(element, target);
    const attrs = automationAttributes(peer, this.tree);
    const previousId = target.id;
    const customName = hasAutomationProperty(peer.Owner, 'Name') || automationReferences(getAutomationProperty(peer.Owner, 'LabeledBy')).length;
    if (!customName && !proxy && hasNativeLabel(target, element)) delete attrs['aria-label'];
    if (!customName && !attrs['aria-label'] && target.hasAttribute('aria-label') && !this.assigned.get(target)?.has('aria-label')) {
      delete attrs['aria-label'];
    }
    this.assign(target, attrs);
    if (target !== element) {
      for (const label of element.querySelectorAll('label')) if (label.htmlFor === previousId) label.htmlFor = target.id;
      if (element.tagName === 'LABEL') element.htmlFor = target.id;
    }
    if (proxy || !target.matches?.(nativeInteractive)) target.tabIndex = peer.IsKeyboardFocusable() ? peer.properties.TabIndex ?? 0 : -1;
    return target;
  }
  assign(element, attrs) {
    const previous = this.assigned.get(element) ?? new Map();
    for (const [name, value] of previous) if (attrs[name] == null && element.getAttribute(name) === value) element.removeAttribute(name);
    const next = new Map();
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null) continue;
      const text = String(value);
      if (element.getAttribute(name) !== text) element.setAttribute(name, text);
      next.set(name, text);
    }
    this.assigned.set(element, next);
  }
  remove(element) {
    const target = this.targets.get(element) ?? this.targetFor(element);
    this.targets.delete(element);
    if (target) this.assigned.delete(target);
    this.assigned.delete(element);
  }
  dispose() { this.assigned.clear(); this.targets.clear(); }
}

function hasNativeLabel(target, owner) {
  if (target.labels?.length && [...target.labels].some(label => label.textContent.trim())) return true;
  if (target.hasAttribute('aria-labelledby')) return true;
  if (['BUTTON', 'A'].includes(target.tagName) && target.textContent.trim()) return true;
  return target !== owner && !!owner.querySelector?.('[data-header]:not([hidden]), [data-part="text-header"]:not([hidden])')?.textContent;
}
