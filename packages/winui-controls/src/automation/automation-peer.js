import { AccessibilityView, AutomationControlType, AutomationEvents, PatternInterface, enumValue } from './enums.js';
import { automationReferences, automationText, getAutomationProperty, hasAutomationProperty } from './automation-properties.js';

const typeName = value => value?.slice(value.lastIndexOf('.') + 1) ?? 'FrameworkElement';
const emptyBounds = () => ({ x: 0, y: 0, width: 0, height: 0 });

/** Root-owned peer with overridable WinUI core methods; disposed peers reject future actions. */
export class AutomationPeer {
  constructor(tree = null) {
    this.tree = tree;
    this.EventsSource = null;
    this.disposed = false;
  }
  get Owner() { return this.tree?.host.nodes.get(this.id) ?? null; }
  get properties() { return this.Owner?.properties ?? {}; }
  assertAlive() { if (this.disposed) throw new Error('SFAX001: Automation peer is disposed'); }
  GetName() { this.assertAlive(); return String(this.GetNameCore() ?? ''); }
  GetAutomationControlType() { this.assertAlive(); return enumValue(AutomationControlType, this.GetAutomationControlTypeCore(), 'control type'); }
  GetClassName() { this.assertAlive(); return String(this.GetClassNameCore() ?? ''); }
  IsEnabled() { this.assertAlive(); return !!this.IsEnabledCore(); }
  IsKeyboardFocusable() { this.assertAlive(); return !!this.IsKeyboardFocusableCore(); }
  HasKeyboardFocus() { this.assertAlive(); return !!this.HasKeyboardFocusCore(); }
  IsOffscreen() { this.assertAlive(); return !!this.IsOffscreenCore(); }
  IsPassword() { this.assertAlive(); return !!this.IsPasswordCore(); }
  IsControlElement() { this.assertAlive(); return !!this.IsControlElementCore(); }
  IsContentElement() { this.assertAlive(); return !!this.IsContentElementCore(); }
  GetBoundingRectangle() { this.assertAlive(); return this.GetBoundingRectangleCore(); }
  GetChildren() { this.assertAlive(); return this.GetChildrenCore() ?? []; }
  GetParent() { this.assertAlive(); return this.GetParentCore(); }
  GetAutomationId() { this.assertAlive(); return String(this.GetAutomationIdCore() ?? ''); }
  GetHelpText() { this.assertAlive(); return String(this.GetHelpTextCore() ?? ''); }
  GetItemStatus() { this.assertAlive(); return String(this.GetItemStatusCore() ?? ''); }
  GetPattern(pattern) { this.assertAlive(); return this.GetPatternCore(enumValue(PatternInterface, pattern, 'pattern')); }
  SetFocus() { this.assertAlive(); return this.SetFocusCore(); }
  GetNameCore() { return ''; }
  GetAutomationControlTypeCore() { return AutomationControlType.Custom; }
  GetClassNameCore() { return ''; }
  IsEnabledCore() { return true; }
  IsKeyboardFocusableCore() { return false; }
  HasKeyboardFocusCore() { return false; }
  IsOffscreenCore() { return false; }
  IsPasswordCore() { return false; }
  IsControlElementCore() { return true; }
  IsContentElementCore() { return true; }
  GetBoundingRectangleCore() { return emptyBounds(); }
  GetChildrenCore() { return []; }
  GetParentCore() { return null; }
  GetAutomationIdCore() { return ''; }
  GetHelpTextCore() { return ''; }
  GetItemStatusCore() { return ''; }
  GetPatternCore() { return null; }
  SetFocusCore() { throw new Error('SFAX002: This automation peer cannot receive focus'); }
  InvalidatePeer() { this.assertAlive(); this.tree?.invalidate(this.id); }
  RaiseAutomationEvent(event) {
    this.assertAlive();
    this.tree?.events.raise(this.EventsSource ?? this, enumValue(AutomationEvents, event, 'automation event'));
  }
  RaisePropertyChangedEvent(property, oldValue, newValue) {
    this.assertAlive();
    this.tree?.events.propertyChanged(this.EventsSource ?? this, property, oldValue, newValue);
  }
  RaiseNotificationEvent(kind, processing, displayString, activityId = '') {
    this.assertAlive();
    this.tree?.events.notify(this.EventsSource ?? this, { kind, processing, text: displayString, activityId });
  }
  dispose() { this.disposed = true; this.tree = null; this.EventsSource = null; }
}

export class FrameworkElementAutomationPeer extends AutomationPeer {
  constructor(owner, tree, definition = {}) {
    super(tree);
    if (!owner?.id || !tree) throw new TypeError('FrameworkElementAutomationPeer requires an owner and automation tree');
    this.id = owner.id;
    this.definition = definition;
    this.patterns = new Map();
  }
  get Owner() { this.assertAlive(); return this.tree.host.nodes.get(this.id) ?? null; }
  get properties() { return this.Owner?.properties ?? {}; }
  get remote() { return this.tree.remote?.get(this.id); }
  GetClassNameCore() { return this.remote?.ClassName ?? typeName(this.Owner?.type); }
  GetAutomationControlTypeCore() { return this.remote?.ControlType ?? this.definition.controlType ?? AutomationControlType.Custom; }
  GetNameCore() { return this.remote?.Name ?? this.tree.nameOf(this.id); }
  GetAutomationIdCore() { return this.remote?.AutomationId ?? getAutomationProperty(this.Owner, 'AutomationId'); }
  GetHelpTextCore() { return this.remote?.HelpText ?? getAutomationProperty(this.Owner, 'HelpText'); }
  GetItemStatusCore() { return this.remote?.ItemStatus ?? getAutomationProperty(this.Owner, 'ItemStatus'); }
  GetParentCore() { return this.tree.getPeer(this.tree.host.parentOf(this.id)); }
  GetChildrenCore() { return this.remote?.Children ? this.remote.Children.map(id => this.tree.getPeer(id)).filter(Boolean)
    : this.tree.childrenOf(this.id); }
  GetBoundingRectangleCore() { return this.tree.host.getLayout(this.id)?.bounds ?? emptyBounds(); }
  IsEnabledCore() { return this.remote?.IsEnabled ?? this.tree.ancestorState(this.id, node => node.properties.IsEnabled !== false && node.properties.IsEnabled !== 0); }
  IsOffscreenCore() { return this.remote?.IsOffscreen ?? !this.tree.isVisible(this.id); }
  IsPasswordCore() { return !!this.definition.password || !!this.remote?.IsPassword; }
  IsKeyboardFocusableCore() {
    if (this.remote) return this.remote.IsKeyboardFocusable;
    return this.IsControlElementCore() && !this.tree.isHidden(this.id) && this.IsEnabledCore() && this.properties.IsTabStop !== false
      && this.properties.IsTabStop !== 0 && (this.definition.focusable || this.properties.IsTabStop === true);
  }
  HasKeyboardFocusCore() { return this.remote?.HasKeyboardFocus ?? this.tree.host.focusManager?.focusedElement === this.id; }
  IsControlElementCore() { return this.remote?.IsControlElement ?? getAutomationProperty(this.Owner, 'AccessibilityView') !== AccessibilityView.Raw; }
  IsContentElementCore() { return this.remote?.IsContentElement ?? getAutomationProperty(this.Owner, 'AccessibilityView') === AccessibilityView.Content; }
  GetPatternCore(pattern) {
    if (this.remote) return this.tree.remote.patternFor(this, pattern);
    if (!(this.definition.patterns ?? []).includes(pattern)) return null;
    if (!this.patterns.has(pattern)) this.patterns.set(pattern, this.tree.createPattern(this, pattern));
    return this.patterns.get(pattern) ?? null;
  }
  SetFocusCore() {
    if (!this.IsKeyboardFocusable()) throw new Error('SFAX002: Element is not keyboard focusable');
    return this.tree.host.focusManager.focus(this.id, 3);
  }
  dispose() { this.patterns.clear(); super.dispose(); }
  static CreatePeerForElement(owner, tree) { return tree.getPeer(typeof owner === 'string' ? owner : owner.id); }
  static FromElement(owner, tree) { return tree.peers.get(typeof owner === 'string' ? owner : owner.id) ?? null; }
}

/** Name derivation is independent of DOM text/value and never reads Password. */
export function nameFromNode(tree, id, visited = new Set()) {
  if (!id || visited.has(id) || visited.size >= 256) return '';
  visited.add(id);
  const node = tree.host.nodes.get(id);
  if (!node) return '';
  if (hasAutomationProperty(node, 'Name')) return automationText(getAutomationProperty(node, 'Name'));
  const label = automationReferences(getAutomationProperty(node, 'LabeledBy'))[0];
  if (label) return nameFromNode(tree, label, visited);
  const definition = tree.definitionFor(node);
  for (const property of definition.nameProperties ?? ['Header', 'Content', 'Label']) {
    const value = node.properties[property];
    const text = value?.$ref ? nameFromNode(tree, value.$ref, visited) : automationText(value);
    if (text) return text;
  }
  if (definition.textChildren) return tree.host.visualChildren(node).map(child => nameFromNode(tree, child, visited)).filter(Boolean).join(' ');
  return '';
}
