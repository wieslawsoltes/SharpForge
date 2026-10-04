import { RoutedEventRouter } from './routed-events.js';
import { PointerEventNames, pointerEventArgs } from './pointer-events.js';
import { PointerCaptureManager } from './pointer-capture.js';
import { keyboardEventArgs } from './keyboard-events.js';
import { FocusManager, FocusState } from './focus-manager.js';
import { GestureRecognizer } from './gestures.js';
import { ManipulationRecognizer } from './manipulation.js';
import { inputFrameClock } from './inertia.js';
import { HitTestTree } from './hit-test.js';
import { DragDropManager } from './drag-drop.js';
import { InputVisualStateTracker } from './visual-state.js';

export const inputEventTypes = Object.freeze(['pointerdown', 'pointermove', 'pointerup', 'pointerover', 'pointerout',
  'pointercancel', 'lostpointercapture', 'wheel', 'keydown', 'keyup', 'focusin', 'focusout',
  'dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'dragend']);

/** Coordinates event routing, capture, focus and gestures for one XamlRoot. */
export class InputManager {
  constructor(host) {
    this.host = host;
    this.hitTests = new HitTestTree();
    this.pointerTargets = new Map();
    this.pointerEvents = new Map();
    this.visualStates = new InputVisualStateTracker(host);
    this.router = new RoutedEventRouter({ parentOf: id => host.layoutEngine.states.get(id)?.parent,
      contains: id => host.nodes.has(id), onTarget: (id, name, args) => host.options.onRoutedTarget?.(id, name, args),
      onDispatch: (id, name, args) => {
        const result = host.options.onRoutedEvent?.(id, name, args);
        if (result && typeof result === 'object') Object.assign(args, result);
        if (!host.options.onRoutedEvent) host.emit(host.nodes.get(id), name, args);
      } });
    this.capture = new PointerCaptureManager({ elementFor: id => host.elements.get(id),
      onLost: (id, args) => this.router.raise(id, 'PointerCaptureLost', {
        ...this.pointerEvents.get(args.Pointer.PointerId), ...args }) });
    this.focus = new FocusManager({ router: this.router, nodes: host.nodes, roots: () => host.visualRoots?.() ?? host.windows,
      isTabStop: id => host.automation?.getPeer(id)?.IsKeyboardFocusable() ?? false,
      childrenOf: id => host.layoutEngine.states.get(id)?.children ?? [],
      parentOf: id => host.layoutEngine.states.get(id)?.parent,
      layoutFor: id => host.getLayout(id), focusElement: (id, state) => {
        const proxy = host.automation?.proxies?.proxies.get(id);
        const element = proxy ?? host.elements.get(id);
        const target = element?.matches('input,textarea,select,button,a,[tabindex]') ? element
          : element?.querySelector('input,textarea,select,button,[tabindex]') ?? element;
        if (target && target.ownerDocument.activeElement !== target) target.focus({ preventScroll: state !== FocusState.Keyboard });
        if (element) element.dataset.focusState = String(state);
      }, onChanged: (previous, next, state) => this.visualStates.focus(previous, next, state) });
    const emit = (id, name, payload) => {
      const result = this.router.raise(id, name, payload);
      if (result) Object.assign(payload, result);
    };
    this.gestures = new GestureRecognizer({ emit });
    this.frameClock = inputFrameClock(host);
    this.manipulations = new ManipulationRecognizer({ emit, ...this.frameClock });
    this.dragDrop = new DragDropManager({ emit, resolve: id => host.nodes.get(id),
      parentOf: id => host.layoutEngine.states.get(id)?.parent, root: host.root,
      containsTarget: (id, target) => !!target && !!host.elements.get(id)?.contains(target),
      bitmapElement: id => host.services.dragBitmapElement?.(id), dataPolicy: host.services.dataTransferPolicy });
  }

  update(layout) { this.hitTests.update(layout, this.host.visualRoots?.() ?? this.host.windows); }

  position(event) {
    const bounds = this.host.root.getBoundingClientRect();
    const scaleX = bounds.width > 0 ? this.host.root.clientWidth / bounds.width : 1;
    const scaleY = bounds.height > 0 ? this.host.root.clientHeight / bounds.height : 1;
    return { x: ((event.clientX ?? bounds.left) - bounds.left) * scaleX + this.host.root.scrollLeft,
      y: ((event.clientY ?? bounds.top) - bounds.top) * scaleY + this.host.root.scrollTop, scaleX, scaleY };
  }

  handle(type, event, nativeId) {
    const position = this.position(event);
    if (type.startsWith('pointer') || type === 'wheel' || type === 'lostpointercapture') {
      this.pointer(type, event, nativeId, position);
    } else if (type === 'keydown' || type === 'keyup') this.keyboard(type, event, nativeId);
    else if (type === 'focusin' && nativeId) this.focus.focus(this.behaviorOwner(nativeId), this.focus.focusState || FocusState.Programmatic);
    else if (type === 'focusout' && !this.host.root.contains(event.relatedTarget)) this.focus.focus(null);
    else if (type.startsWith('drag') || type === 'drop') this.dragDrop.handle(type, this.hitTests.hitTest(position) ?? nativeId, event, position);
  }

  pointer(type, event, nativeId, position) {
    const pointerId = event.pointerId ?? 1;
    const physical = this.hitTests.hitTest(position) ?? nativeId;
    this.visualStates.pointer(type, physical, event);
    if (type === 'lostpointercapture') { this.capture.lost(pointerId); return; }
    const id = this.capture.owner(pointerId) ?? physical;
    if (!id) return;
    const name = PointerEventNames[type] ?? (type === 'pointerover' ? 'PointerEntered' : type === 'pointerout' ? 'PointerExited' : null);
    const payload = pointerEventArgs(event, position);
    if (!this.pointerEvents.has(pointerId) && this.pointerEvents.size >= 256) this.pointerEvents.delete(this.pointerEvents.keys().next().value);
    this.pointerEvents.set(pointerId, payload);
    if (name) {
      const args = this.router.raise(id, name, payload,
        type === 'pointerover' || type === 'pointerout' ? 'direct' : 'bubble');
      if (args?.Handled && event.cancelable) event.preventDefault();
    }
    const pointer = { pointerId, x: position.x, y: position.y, pointerType: event.pointerType, button: event.button };
    const properties = this.host.nodes.get(id)?.properties ?? {};
    if (type === 'pointerdown') {
      this.pointerTargets.set(pointerId, id);
      this.gestures.down(id, pointer, properties);
      this.manipulations.down(id, pointer, properties.ManipulationMode ?? 0);
      const focusId = this.behaviorOwner(id), focusProperties = this.host.nodes.get(focusId)?.properties ?? {};
      if (focusProperties.IsTabStop === true || focusProperties.TabIndex !== undefined || this.host.automation?.getPeer(focusId)?.IsKeyboardFocusable()) {
        this.focus.focus(focusId, FocusState.Pointer);
      }
    } else if (type === 'pointermove') {
      this.gestures.move(pointer);
      this.manipulations.move(this.pointerTargets.get(pointerId) ?? id, pointer);
    } else if (type === 'pointerup' || type === 'pointercancel') {
      if (type === 'pointercancel') this.gestures.cancel(pointerId);
      else this.gestures.up(pointer);
      this.manipulations.up(this.pointerTargets.get(pointerId) ?? id, pointerId, type === 'pointercancel');
      const owner = this.capture.owner(pointerId);
      if (owner != null) this.capture.release(owner, pointerId, type === 'pointercancel' ? 'Canceled' : 'Released');
      this.pointerTargets.delete(pointerId);
      this.pointerEvents.delete(pointerId);
    }
  }

  keyboard(type, event, nativeId) {
    const id = this.focus.focusedElement ?? this.behaviorOwner(nativeId);
    if (!id) return;
    this.visualStates.keyboard(type, id, event);
    const args = keyboardEventArgs(event);
    const suffix = type === 'keydown' ? 'Down' : 'Up';
    const preview = this.router.raise(id, 'PreviewKey' + suffix, args, 'tunnel');
    const bubbling = this.router.raise(id, 'Key' + suffix, preview ?? args);
    if (bubbling?.Handled) { event.preventDefault(); return; }
    if (type === 'keydown' && event.key === 'Tab' && this.focus.tryMoveFocus(event.shiftKey ? 'Previous' : 'Next')) event.preventDefault();
    if (type === 'keydown' && args.Character && !event.isComposing && !event.ctrlKey && !event.metaKey) {
      this.router.raise(id, 'CharacterReceived', { Character: args.Character, KeyStatus: args.KeyStatus });
    }
  }

  behaviorOwner(id) {
    let current = id;
    for (let depth = 0; depth < 512; depth++) {
      const owner = this.host.nodes.get(current)?.templateOwner;
      if (!owner || owner === current) return current;
      current = owner;
    }
    throw new RangeError('SFUI1605: Template input ownership limit');
  }

  removeNode(id, { removeHandlers = true } = {}) {
    this.visualStates.removeNode(id);
    this.capture.releaseAll(id);
    this.focus.removeNode(id);
    this.gestures.removeNode(id);
    this.manipulations.removeNode(id);
    if (removeHandlers) { this.router.removeNode(id); this.dragDrop.removeNode(id); }
    for (const [pointerId, target] of this.pointerTargets) if (target === id) this.pointerTargets.delete(pointerId);
  }
  dispose() {
    this.capture.dispose();
    this.focus.dispose();
    this.visualStates.dispose();
    this.gestures.dispose();
    this.manipulations.dispose();
    this.frameClock.dispose();
    this.dragDrop.dispose();
    this.router.dispose();
    this.pointerTargets.clear();
    this.pointerEvents.clear();
  }
}
