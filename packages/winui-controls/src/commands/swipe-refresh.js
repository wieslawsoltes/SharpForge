import { forwardDeferredControlEvent } from '../policy/event-requests.js';
import { ControlEvents, ControlError, stateFor, registerFamily, createPart, emitChange } from '../policy/events.js';
import { dispatchDeferred } from '../overlay/deferrals.js';
import { commandCanExecute, executeCommand } from './command.js';

export class RefreshController extends ControlEvents {
  constructor({ timeout = 30_000 } = {}) {
    super();
    this.timeout = timeout;
    this.pending = null;
    this.controller = null;
    this.disposed = false;
  }
  request({ signal } = {}) {
    if (this.disposed) throw new ControlError('SFUI1662', 'Refresh control was disposed');
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let resolveResult;
    let rejectResult;
    this.pending = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const result = this.pending;
    const finish = (value, error) => {
      signal?.removeEventListener('abort', abort);
      this.pending = null;
      this.controller = null;
      try { this.emit('StateChanged', { State: 'Idle' }); }
      catch (failure) { error ??= failure; }
      if (error) rejectResult(error);
      else resolveResult(value);
    };
    try { this.emit('StateChanged', { State: 'Refreshing' }); }
    catch (error) { finish(null, error); return result; }
    dispatchDeferred(this, 'RefreshRequested', {}, { timeout: this.timeout, signal: controller.signal })
      .then(value => finish(value), error => finish(null, error));
    return result;
  }
  snapshot() {
    if (this.pending) throw new ControlError('SFUI1660', 'An active refresh deferral cannot be snapshotted');
    return { version: 1, timeout: this.timeout };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || this.pending) throw new ControlError('SFUI1660', 'Cannot restore refresh state');
    this.timeout = snapshot.timeout;
  }
  dispose() {
    this.disposed = true;
    this.controller?.abort(new ControlError('SFUI1662', 'Refresh control was disposed'));
    super.dispose();
  }
}

function swipeItems(context, node, direction) {
  const reference = node.properties[direction + 'Items'];
  const collection = reference?.$ref ? context.nodes.get(reference.$ref) : null;
  return { items: collection?.items ?? collection?.collections.Items ?? node.collections[direction + 'Items'] ?? [],
    mode: collection?.properties.Mode ?? node.properties.SwipeMode ?? 0 };
}

function invokeSwipe(context, owner, reference, mode) {
  const item = context.nodes.get(reference?.$ref);
  if (!item || !commandCanExecute(context, item)) return false;
  executeCommand(context, item);
  context.emit(item, 'Invoked', { SwipeControl: { $ref: owner.id } });
  const behavior = item.properties.BehaviorOnInvoked ?? 0;
  if (behavior === 1 || behavior === 0 && mode === 0) owner.properties.IsOpen = false;
  context.invalidate(owner.id);
  return true;
}

function gestureState(context, node) {
  return stateFor(context, node, 'swipe-refresh', () => ({ start: null, direction: null, refresh: null,
    dispose() { this.refresh?.dispose(); } }));
}

function gesture(context, node, element, event) {
  const state = gestureState(context, node);
  if (event.type === 'pointerdown') { state.start = { x: event.clientX, y: event.clientY }; return false; }
  if (event.type !== 'pointerup' || !state.start) return false;
  const dx = event.clientX - state.start.x;
  const dy = event.clientY - state.start.y;
  state.start = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 48) return false;
  if (node.type.endsWith('RefreshContainer') && dy > Math.abs(dx) && element.scrollTop <= 0) {
    if (!state.refresh) {
      state.refresh = new RefreshController();
      state.refresh.on('RefreshRequested', args => forwardDeferredControlEvent(context, node, 'RefreshRequested', args));
      state.refresh.on('StateChanged', args => {
        node.properties.IsRefreshing = args.State === 'Refreshing';
        const visualizer = context.nodes.get(node.properties.Visualizer?.$ref);
        if (visualizer) visualizer.properties.State = node.properties.IsRefreshing ? 3 : 0;
        context.invalidate(node.id);
      });
    }
    state.refresh.request().catch(error => context.host.options.onError?.(error));
    return true;
  }
  state.direction = Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 'Left' : 'Right' : dy > 0 ? 'Top' : 'Bottom';
  const { items, mode } = swipeItems(context, node, state.direction);
  if (items.length) {
    node.properties.IsOpen = true;
    node.properties.OpenDirection = state.direction;
    if (mode === 1) invokeSwipe(context, node, items[0], mode);
    context.invalidate(node.id);
  }
  return true;
}

export function registerGestureRenderers(registry) {
  registerFamily(registry, ['SwipeControl', 'RefreshContainer', 'RefreshVisualizer'], {
    create(context) {
      const element = context.document.createElement('div');
      element.append(createPart(context.document, 'div', 'swipe-actions'), createPart(context.document, 'div', 'swipe-content'));
      return element;
    }, render(context, node, element) {
      const [actions, content] = element.children;
      context.content(content, node.properties.Content);
      actions.hidden = !node.properties.IsOpen;
      const { items } = swipeItems(context, node, node.properties.OpenDirection ?? 'Left');
      const children = items.map(value => context.host.ensure(value.$ref)).filter(Boolean);
      for (const child of children) child.dataset.swipeOwner = node.id;
      context.ordered(actions, children);
      element.setAttribute('aria-busy', String(!!node.properties.IsRefreshing));
    }, events: { pointerdown: gesture, pointerup: gesture }
  });
  registerFamily(registry, 'SwipeItem', { create: context => createPart(context.document, 'button', 'swipe-item'),
    render(context, node, element) { element.textContent = node.properties.Text ?? ''; },
    events: { click(context, node, element) {
      const owner = context.nodes.get(element.dataset.swipeOwner);
      return owner ? invokeSwipe(context, owner, { $ref: node.id }, swipeItems(context, owner, owner.properties.OpenDirection ?? 'Left').mode) : false;
    } }
  });
}
