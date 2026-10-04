import { AutomationPeer } from './automation-peer.js';
import { AutomationControlType, PatternInterface } from './enums.js';
import { automationText } from './automation-properties.js';
import { transformBounds } from '../layout/render-properties.js';

/** A logical list occurrence keeps peer identity when its DOM container is recycled. */
export class VirtualItemAutomationPeer extends AutomationPeer {
  constructor(parent, key) {
    super(parent.tree);
    this.parent = parent;
    this.ownerId = parent.id;
    this.key = key;
    this.id = parent.id + '::item:' + String(key);
    this.definition = { controlType: AutomationControlType.ListItem, role: 'option', focusable: true,
      patterns: [PatternInterface.SelectionItem, PatternInterface.ScrollItem] };
    this.patterns = new Map([
      [PatternInterface.SelectionItem, new VirtualSelectionItemProvider(this)],
      [PatternInterface.ScrollItem, { peer: this, ScrollIntoView: () => this.action('ScrollIntoView') }]
    ]);
  }
  get model() { return this.tree.modelFor(this.parent, 'getSelectionModel'); }
  get index() { return this.model?.indexOfKey(this.key) ?? -1; }
  get item() { return this.model?.getAt(this.index); }
  get realized() { return this.tree.realizedItems(this.parent).find(item => Object.is(item.key, this.key)) ?? null; }
  get Owner() {
    return { id: this.id, type: 'Microsoft.UI.Xaml.Controls.ListViewItem', properties: {
      Content: this.item, IsSelected: this.model?.isSelected(this.index) ?? false, IsEnabled: this.parent.IsEnabled(),
      'AutomationProperties.PositionInSet': this.index + 1, 'AutomationProperties.SizeOfSet': this.model?.count ?? 0 } };
  }
  GetNameCore() {
    const id = this.tree.host.services?.automationItemId?.(this.item) ?? this.item?.$ref ?? this.item?.id;
    if (id && this.tree.host.nodes.has(id)) return this.tree.nameOf(id);
    return this.tree.host.services?.automationItemText?.(this.item, this.parent.Owner) ?? automationText(this.item);
  }
  GetClassNameCore() { return 'ListViewItem'; }
  GetAutomationControlTypeCore() { return AutomationControlType.ListItem; }
  GetParentCore() { return this.parent; }
  GetChildrenCore() { return []; }
  GetBoundingRectangleCore() {
    const item = this.realized;
    if (!item) return { x: 0, y: 0, width: 0, height: 0 };
    const element = item.element;
    const root = this.tree.host.root;
    if (element?.getBoundingClientRect && root?.getBoundingClientRect) {
      const bounds = element.getBoundingClientRect(), frame = root.getBoundingClientRect();
      const sx = frame.width ? root.clientWidth / frame.width : 1, sy = frame.height ? root.clientHeight / frame.height : 1;
      return { x: (bounds.left - frame.left) * sx, y: (bounds.top - frame.top) * sy, width: bounds.width * sx, height: bounds.height * sy };
    }
    const layout = this.tree.host.getLayout(this.parent.id);
    const scroll = this.tree.modelFor(this.parent, 'getScrollMetrics');
    return layout ? transformBounds(layout.worldTransform, { x: item.x - (scroll?.left ?? scroll?.HorizontalOffset ?? 0),
      y: item.y - (scroll?.top ?? scroll?.VerticalOffset ?? 0), width: item.width, height: item.height })
      : { x: 0, y: 0, width: 0, height: 0 };
  }
  IsEnabledCore() { return this.index >= 0 && this.parent.IsEnabled(); }
  IsKeyboardFocusableCore() { return this.IsEnabled(); }
  HasKeyboardFocusCore() {
    const element = this.realized?.element, focused = element?.ownerDocument.activeElement;
    return !!element && (element === focused || element.contains(focused));
  }
  IsOffscreenCore() {
    if (this.parent.IsOffscreen() || !this.realized) return true;
    const a = this.GetBoundingRectangle(), b = this.parent.GetBoundingRectangle();
    return a.width <= 0 || a.height <= 0 || a.x + a.width <= b.x || a.y + a.height <= b.y || a.x >= b.x + b.width || a.y >= b.y + b.height;
  }
  GetPatternCore(pattern) { return this.patterns.get(pattern) ?? null; }
  SetFocusCore() {
    this.action('ScrollIntoView');
    this.tree.host.focusManager.focus(this.parent.id, 3);
    this.realized?.element?.focus?.();
  }
  action(method) {
    this.assertAlive();
    if (!this.IsEnabled()) throw new Error('SFAX003: Automation item is removed or disabled');
    const result = this.tree.host.invoke(this.parent.id, method, [this.index]);
    this.tree.host.flush?.();
    return result;
  }
}

class VirtualSelectionItemProvider {
  constructor(peer) { this.peer = peer; }
  get IsSelected() { return this.peer.model?.isSelected(this.peer.index) ?? false; }
  get SelectionContainer() { return this.peer.parent; }
  Select() { return this.peer.action('Select'); }
  AddToSelection() { return this.peer.action('AddToSelection'); }
  RemoveFromSelection() { return this.peer.action('RemoveFromSelection'); }
}
