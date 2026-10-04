import { forwardDeferredControlEvent } from '../policy/event-requests.js';
import { OverlayManager } from './overlay-manager.js';
import { ControlEvents, ControlError, createPart, stateFor, registerFamily, controlName } from '../policy/events.js';
import { dispatchDeferred } from './deferrals.js';
import { executeCommand, commandCanExecute } from '../commands/command.js';
import { teachingTipPlacement } from './placement.js';
import { renderTeachingTipChrome } from './teachingtip.js';
import { setTooltipDescription } from './tooltip-description.js';

export { OverlayManager } from './overlay-manager.js';
export { DeferralGroup, dispatchDeferred } from './deferrals.js';
export { placeOverlay, flyoutPlacements, teachingTipPlacement } from './placement.js';
export { teachingTipTail } from './teachingtip.js';

export function teachingTipCloseReason(reason) {
  if (reason === 0 || reason === 'Close' || reason === 'close-button') return 0;
  if (reason === 1 || reason === 'light-dismiss' || reason === 'escape') return 1;
  return 2;
}

export function overlayManager(context) {
  if (!context.services.overlays) {
    const manager = new OverlayManager({ root: context.root });
    manager.on('Error', ({ error }) => context.host.options.onError?.(error));
    context.services.overlays = manager;
  }
  return context.services.overlays;
}

function overlayState(context, node) {
  return stateFor(context, node, 'overlay', () => {
    const events = new ControlEvents();
    const state = { events, entry: null, opening: false, showPromise: null,
      dispose() { if (this.entry) context.services.overlays?.dismiss(this.entry); events.dispose(); } };
    for (const name of ['Opening', 'Opened', 'Closing', 'Closed', 'PrimaryButtonClick', 'SecondaryButtonClick', 'CloseButtonClick', 'ActionButtonClick']) {
      events.on(name, args => {
        if (controlName(node) === 'TeachingTip' && (name === 'Closing' || name === 'Closed')) {
          args.Reason = teachingTipCloseReason(args.Reason);
        }
        if (name === 'Closed') {
          node.properties.IsOpen = false; state.entry = null; state.showPromise = null;
          context.host.registry.resolve(node.type)?.overlayClosed?.(context, node);
        }
        if (controlName(node) === 'Popup' && name !== 'Opened' && name !== 'Closed') return;
        if (typeof args.GetDeferral === 'function') forwardDeferredControlEvent(context, node, name, args);
        else context.emit(node, name, args);
      });
    }
    return state;
  });
}

export function showControlOverlay(context, node, {
  target, point, modal = controlName(node) === 'ContentDialog', rejectConcurrent = false
} = {}) {
  const state = overlayState(context, node);
  if (state.showPromise) {
    if (modal && rejectConcurrent) throw new ControlError('SFUI1664', 'ContentDialog.ShowAsync is already pending');
    return state.showPromise;
  }
  const element = context.host.ensure(node.id);
  if (!element) return Promise.reject(new ControlError('SFUI1666', 'Overlay owner is not in the current scene'));
  const manager = overlayManager(context);
  let resolveResult, rejectResult;
  state.showPromise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const result = state.showPromise;
  state.opening = true;
  try {
    const sceneNode = context.nodes.get(node.id) ?? node;
    context.host.registry.resolve(sceneNode.type)?.render?.(context, sceneNode, element);
    let anchor = target ?? context.elements.get(node.properties.Target?.$ref);
    if (point) {
      if (!anchor || !Number.isFinite(point.X) || !Number.isFinite(point.Y)) {
        throw new ControlError('SFUI1665', 'Point flyout placement requires a target and finite coordinates');
      }
      const origin = anchor;
      anchor = { contains: element => origin.contains(element), getBoundingClientRect() {
        const rect = origin.getBoundingClientRect();
        const left = rect.left + point.X * (origin.clientWidth ? rect.width / origin.clientWidth : 1);
        const top = rect.top + point.Y * (origin.clientHeight ? rect.height / origin.clientHeight : 1);
        return { left, top, width: 0, height: 0, right: left, bottom: top };
      } };
    }
    const placement = point ? 'BottomEdgeAlignedLeft' : controlName(node) === 'TeachingTip'
      ? teachingTipPlacement(node.properties.PreferredPlacement ?? 0, !!anchor)
      : node.properties.Placement ?? 'Bottom';
    state.entry = manager.show(element, { id: node.id, anchor,
      focus: controlName(node) !== 'ToolTip', modal, lightDismiss: !modal && node.properties.IsLightDismissEnabled !== false, events: state.events,
      placement,
      offsets: { x: node.properties.HorizontalOffset ?? 0, y: node.properties.VerticalOffset ?? 0 },
      constrain: node.properties.ShouldConstrainToRootBounds !== false });
    node.properties.IsOpen = !!state.entry;
    context.invalidate(node.id);
    if (state.entry) state.entry.result.then(resolveResult, rejectResult);
    else { resolveResult(0); state.showPromise = null; }
  } catch (error) { state.showPromise = null; rejectResult(error); }
  finally { state.opening = false; }
  return result;
}

export function hideControlOverlay(context, node, options = {}) {
  const state = overlayState(context, node);
  return overlayManager(context).close(state.entry, options);
}

function renderOverlay(context, node, element) {
  const properties = node.properties;
  const kind = controlName(node);
  const state = overlayState(context, node);
  if (['Popup', 'Flyout', 'ToolTip', 'FlyoutBase'].includes(kind)) {
    context.content(element, properties.Child ?? properties.Content);
  } else {
    const [title, subtitle, content, footer, hero] = element.children;
    title.textContent = String(properties.Title ?? '');
    subtitle.textContent = String(properties.Subtitle ?? '');
    subtitle.hidden = !properties.Subtitle;
    context.content(content, properties.Content);
    context.content(hero, properties.HeroContent);
    hero.hidden = properties.HeroContent == null;
    for (const button of footer.children) {
      const action = button.dataset.dialogAction;
      const text = properties[action + 'ButtonContent'] ?? properties[action + 'ButtonText'] ?? '';
      context.content(button, text);
      button.hidden = text === '' || text == null;
      button.disabled = properties['Is' + action + 'ButtonEnabled'] === false || !commandCanExecute(context,
        { ...node, properties: { Command: properties[action + 'ButtonCommand'],
          CommandParameter: properties[action + 'ButtonCommandParameter'] } });
    }
    element.setAttribute('aria-labelledby', title.id);
    if (kind === 'TeachingTip') renderTeachingTipChrome(context, node, element);
  }
  element.hidden = !properties.IsOpen;
  if (kind === 'ToolTip') element.setAttribute('role', 'tooltip');
  if (properties.IsOpen && !state.entry && !state.opening) {
    state.opening = true;
    showControlOverlay(context, node).catch(error => context.host.options.onError?.(error));
    state.opening = false;
  } else if (!properties.IsOpen && state.entry && !state.entry.closing) {
    hideControlOverlay(context, node).catch(error => context.host.options.onError?.(error));
  }
}

function overlayClick(context, node, element, event) {
  const button = event.target.closest?.('[data-dialog-action]');
  if (!button || button.disabled) return false;
  const action = button.dataset.dialogAction;
  const state = overlayState(context, node);
  dispatchDeferred(state.events, action + 'ButtonClick', {}, { timeout: overlayManager(context).timeout }).then(args => {
    if (args.Cancel) return;
    const properties = node.properties;
    if (properties[action + 'ButtonCommand']) executeCommand(context, { ...node, properties: {
      ...properties, Command: properties[action + 'ButtonCommand'], CommandParameter: properties[action + 'ButtonCommandParameter'] } });
    if (controlName(node) === 'TeachingTip' && action === 'Action') return;
    return hideControlOverlay(context, node, { reason: action, result: action === 'Primary' ? 1 : action === 'Secondary' ? 2 : 0 });
  }).catch(error => context.host.options.onError?.(error));
  return true;
}

export function registerOverlayRenderers(registry) {
  registerFamily(registry, ['Popup', 'FlyoutBase', 'Flyout', 'ContentDialog', 'TeachingTip', 'ToolTip'], {
    create(context, node) {
      const element = context.document.createElement('div');
      element.tabIndex = -1;
      if (['ContentDialog', 'TeachingTip'].includes(controlName(node))) {
        const title = createPart(context.document, 'h2', 'overlay-title');
        title.id = 'sf-dialog-title-' + node.id.replace(/[^\w-]/g, '-');
        const footer = createPart(context.document, 'div', 'overlay-buttons');
        for (const action of ['Primary', 'Secondary', 'Close', 'Action']) {
          const button = createPart(context.document, 'button', 'overlay-button');
          button.dataset.dialogAction = action;
          footer.append(button);
        }
        element.append(title, createPart(context.document, 'p', 'overlay-subtitle'),
          createPart(context.document, 'div', 'overlay-content'), footer, createPart(context.document, 'div', 'overlay-hero'));
      }
      return element;
    }, render: renderOverlay,
    afterLayout(context, node, element) {
      if (controlName(node) === 'TeachingTip') {
        renderTeachingTipChrome(context, node, context.getState(node).familyTemplate?.root ?? element);
      }
    },
    invoke(context, node, element, method, args = []) {
      if (['Show', 'ShowAt', 'ShowAsync', 'Expand'].includes(method)) {
        return showControlOverlay(context, node, {
          target: args[0]?.$ref ? context.host.ensure(args[0].$ref) : args[0], point: args[1], rejectConcurrent: method === 'ShowAsync'
        });
      }
      if (method === 'Hide' || method === 'Collapse') return hideControlOverlay(context, node);
      return undefined;
    }, events: { click: overlayClick,
      keydown(context, node, element, event) {
        if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return false;
        const action = ['None', 'Primary', 'Secondary', 'Close'][node.properties.DefaultButton ?? 0];
        const button = element.querySelector(`[data-dialog-action="${action}"]`);
        if (!button || button.disabled || button.hidden) return false;
        event.preventDefault();
        button.click();
        return true;
      } }
  });
}

/** Tooltip listeners are owned by the element and removed when the returned lease is disposed. */
export function attachToolTip(context, target, tooltipNode, { delay = 500, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer = null;
  let disposed = false;
  const element = context.host.ensure(tooltipNode.id);
  if (!element) throw new ControlError('SFUI1666', 'Tooltip owner is not in the current scene');
  if (!element.id) element.id = 'sf-tooltip-' + tooltipNode.id.replace(/[^\w-]/g, '-');
  const state = overlayState(context, tooltipNode);
  const opened = state.events.on('Opened', () => setTooltipDescription(target, element.id, true));
  const closed = state.events.on('Closed', () => setTooltipDescription(target, element.id, false));
  const hide = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (state.entry) overlayManager(context).dismiss(state.entry);
    setTooltipDescription(target, element.id, false);
  };
  const show = () => {
    hide();
    if (disposed) return;
    timer = schedule(() => {
      timer = null;
      if (disposed) return;
      showControlOverlay(context, tooltipNode, { target }).catch(error => context.host.options.onError?.(error));
    }, delay);
  };
  const key = event => { if (event.key === 'Escape') hide(); };
  for (const name of ['pointerenter', 'focusin']) target.addEventListener(name, show);
  for (const name of ['pointerleave', 'focusout', 'pointerdown']) target.addEventListener(name, hide);
  target.addEventListener('keydown', key);
  return { dispose() {
    disposed = true;
    hide();
    opened();
    closed();
    for (const name of ['pointerenter', 'focusin']) target.removeEventListener(name, show);
    for (const name of ['pointerleave', 'focusout', 'pointerdown']) target.removeEventListener(name, hide);
    target.removeEventListener('keydown', key);
  } };
}
