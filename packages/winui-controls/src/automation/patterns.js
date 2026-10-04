import { PatternInterface, ScrollAmount, ToggleState, ExpandCollapseState, enumValue } from './enums.js';
import { TextProvider } from './text-provider.js';

function action(peer, method, args = []) {
  peer.assertAlive();
  if (!peer.IsEnabled()) throw new Error('SFAX003: Automation action targets a disabled control');
  const result = peer.tree.host.invoke(peer.id, method, args);
  peer.tree.host.flush?.();
  return result;
}

function writable(peer) {
  if (peer.properties.IsReadOnly) throw new Error('SFAX004: Automation value is read-only');
}

export class InvokeProvider {
  constructor(peer) { this.peer = peer; }
  Invoke() { return action(this.peer, 'Invoke'); }
}

export class ToggleProvider {
  constructor(peer) { this.peer = peer; }
  get ToggleState() {
    if (this.peer.properties.IsIndeterminate) return ToggleState.Indeterminate;
    const value = this.peer.properties.IsChecked ?? this.peer.properties.IsOn;
    return value == null && this.peer.properties.IsThreeState ? ToggleState.Indeterminate : value ? ToggleState.On : ToggleState.Off;
  }
  Toggle() { return action(this.peer, 'Toggle'); }
}

export class ValueProvider {
  constructor(peer) { this.peer = peer; }
  get IsReadOnly() { return !!this.peer.properties.IsReadOnly || this.peer.definition.editableValue && !this.peer.properties.IsEditable; }
  get Value() {
    this.peer.assertAlive();
    if (this.peer.IsPassword()) throw new Error('SFAX005: Password values are private');
    return String(this.peer.properties.Text ?? this.peer.properties.Value ?? '');
  }
  SetValue(value) {
    if (this.IsReadOnly) throw new Error('SFAX004: Automation value is read-only');
    writable(this.peer);
    if (typeof value !== 'string' || value.length > 16 * 1024 * 1024) throw new TypeError('SFAX006: Value requires bounded text');
    return action(this.peer, 'SetValue', [value]);
  }
}

export class RangeValueProvider {
  constructor(peer) { this.peer = peer; }
  get IsReadOnly() { return !!this.peer.properties.IsReadOnly || !!this.peer.definition.readOnlyRange; }
  get Value() { return this.peer.properties.Value ?? 0; }
  get Minimum() { return this.peer.properties.Minimum ?? 0; }
  get Maximum() { return this.peer.properties.Maximum ?? 100; }
  get SmallChange() { return this.peer.properties.SmallChange ?? 1; }
  get LargeChange() { return this.peer.properties.LargeChange ?? 10; }
  SetValue(value) {
    if (this.IsReadOnly) throw new Error('SFAX004: Automation range is read-only');
    if (!Number.isFinite(value) || value < this.Minimum || value > this.Maximum) throw new RangeError('SFAX006: Value is outside the range');
    return action(this.peer, 'SetValue', [value]);
  }
}

export class SelectionProvider {
  constructor(peer) { this.peer = peer; }
  get CanSelectMultiple() { return [2, 3, 'Multiple', 'Extended'].includes(this.peer.properties.SelectionMode); }
  get IsSelectionRequired() { return !!this.peer.properties.IsSelectionRequired || !!this.peer.definition.selectionRequired; }
  GetSelection() {
    this.peer.assertAlive();
    const model = this.peer.tree.modelFor(this.peer, 'getSelectionModel');
    if (model?.selectedIndices && model?.keyAt) {
      return model.selectedIndices.map(index => this.peer.tree.itemPeer(this.peer, index)).filter(Boolean);
    }
    const items = model?.selectedItems ?? this.peer.properties.SelectedItems
      ?? (this.peer.properties.SelectedItem == null ? [] : [this.peer.properties.SelectedItem]);
    return items.map(item => this.peer.tree.getPeer(item?.$ref ?? item?.id)).filter(Boolean);
  }
}

export class SelectionItemProvider {
  constructor(peer) { this.peer = peer; }
  get IsSelected() { return !!(this.peer.properties.IsSelected ?? this.peer.properties.IsChecked); }
  get SelectionContainer() {
    let parent = this.peer.GetParent();
    for (let depth = 0; parent && depth < 512; depth++, parent = parent.GetParent()) {
      if (parent.GetPattern(PatternInterface.Selection)) return parent;
    }
    return null;
  }
  Select() { return action(this.peer, 'Select'); }
  AddToSelection() { return action(this.peer, 'AddToSelection'); }
  RemoveFromSelection() { return action(this.peer, 'RemoveFromSelection'); }
}

export class ExpandCollapseProvider {
  constructor(peer) { this.peer = peer; }
  get ExpandCollapseState() {
    if (this.peer.definition.leaf?.(this.peer.Owner)) return ExpandCollapseState.LeafNode;
    const expanded = this.peer.properties.IsExpanded ?? this.peer.properties.IsDropDownOpen ?? this.peer.properties.IsOpen;
    return expanded ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed;
  }
  Expand() { return action(this.peer, 'Expand'); }
  Collapse() { return action(this.peer, 'Collapse'); }
}

export class ScrollProvider {
  constructor(peer) { this.peer = peer; }
  get metrics() {
    const supplied = this.peer.tree.modelFor(this.peer, 'getScrollMetrics');
    if (supplied) return { width: supplied.width ?? supplied.ViewportWidth ?? 0, height: supplied.height ?? supplied.ViewportHeight ?? 0,
      extentWidth: supplied.extentWidth ?? supplied.ExtentWidth ?? 0, extentHeight: supplied.extentHeight ?? supplied.ExtentHeight ?? 0,
      left: supplied.left ?? supplied.HorizontalOffset ?? 0, top: supplied.top ?? supplied.VerticalOffset ?? 0 };
    const properties = this.peer.properties;
    const layout = this.peer.tree.host.layoutEngine?.states.get(this.peer.id)?.data.scroll;
    return { width: properties.ViewportWidth ?? layout?.viewport.width ?? 0,
      height: properties.ViewportHeight ?? layout?.viewport.height ?? 0,
      extentWidth: properties.ExtentWidth ?? layout?.extent.width ?? 0,
      extentHeight: properties.ExtentHeight ?? layout?.extent.height ?? 0,
      left: properties.HorizontalOffset ?? 0, top: properties.VerticalOffset ?? 0 };
  }
  get HorizontallyScrollable() { const m = this.metrics; return m.extentWidth > m.width; }
  get VerticallyScrollable() { const m = this.metrics; return m.extentHeight > m.height; }
  get HorizontalScrollPercent() { const m = this.metrics; return this.HorizontallyScrollable ? m.left / (m.extentWidth - m.width) * 100 : -1; }
  get VerticalScrollPercent() { const m = this.metrics; return this.VerticallyScrollable ? m.top / (m.extentHeight - m.height) * 100 : -1; }
  get HorizontalViewSize() { const m = this.metrics; return m.extentWidth ? Math.min(100, m.width / m.extentWidth * 100) : 100; }
  get VerticalViewSize() { const m = this.metrics; return m.extentHeight ? Math.min(100, m.height / m.extentHeight * 100) : 100; }
  Scroll(horizontalAmount, verticalAmount) {
    const horizontal = enumValue(ScrollAmount, horizontalAmount, 'ScrollAmount');
    const vertical = enumValue(ScrollAmount, verticalAmount, 'ScrollAmount');
    if (!this.peer.definition.layoutScroll) return action(this.peer, 'Scroll', [horizontal, vertical]);
    const m = this.metrics;
    const delta = (amount, viewport) => [-viewport, -16, 0, viewport, 16][amount];
    return action(this.peer, 'ChangeView', [m.left + delta(horizontal, m.width), m.top + delta(vertical, m.height), null, true]);
  }
  SetScrollPercent(horizontal, vertical) {
    for (const value of [horizontal, vertical]) if (!Number.isFinite(value) || value !== -1 && (value < 0 || value > 100)) {
      throw new RangeError('SFAX006: Scroll percent must be -1 or between 0 and 100');
    }
    if (!this.peer.definition.layoutScroll) return action(this.peer, 'SetScrollPercent', [horizontal, vertical]);
    if (horizontal !== -1 && !this.HorizontallyScrollable || vertical !== -1 && !this.VerticallyScrollable) {
      throw new Error('SFAX007: Requested axis is not scrollable');
    }
    const m = this.metrics;
    return action(this.peer, 'ChangeView', [horizontal === -1 ? null : horizontal * (m.extentWidth - m.width) / 100,
      vertical === -1 ? null : vertical * (m.extentHeight - m.height) / 100, null, true]);
  }
}

export class ScrollItemProvider {
  constructor(peer) { this.peer = peer; }
  ScrollIntoView() { return action(this.peer, 'ScrollIntoView'); }
}

const providers = new Map([[PatternInterface.Invoke, InvokeProvider], [PatternInterface.Toggle, ToggleProvider],
  [PatternInterface.Value, ValueProvider], [PatternInterface.RangeValue, RangeValueProvider],
  [PatternInterface.Selection, SelectionProvider], [PatternInterface.SelectionItem, SelectionItemProvider],
  [PatternInterface.ExpandCollapse, ExpandCollapseProvider], [PatternInterface.Scroll, ScrollProvider],
  [PatternInterface.ScrollItem, ScrollItemProvider], [PatternInterface.Text, TextProvider]]);

export function createAutomationPattern(peer, pattern) {
  const Provider = providers.get(pattern);
  return Provider ? new Provider(peer) : null;
}
