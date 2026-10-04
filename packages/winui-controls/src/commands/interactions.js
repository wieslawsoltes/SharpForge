import { requestControlEvent } from '../policy/event-requests.js';
import { attachTextToolTip } from '../overlay/text-tooltip.js';
import { KeyboardAcceleratorRouter } from './accelerators.js';
import { commandCanExecute, executeCommand } from './command.js';
import { attachToolTip, showControlOverlay } from '../overlay/index.js';

function sceneNode(context, value) {
  return value?.$ref ? context.nodes.get(value.$ref) : null;
}

function invokeControl(context, node, element) {
  const descriptor = context.host.registry.resolve(node.type);
  const value = descriptor?.invoke ? context.host.invoke(node.id, 'Invoke', []) : undefined;
  if (value === undefined && commandCanExecute(context, node)) {
    if (node.properties.Command) executeCommand(context, node);
    else element.focus();
  }
}

/** Each host owns its shortcut leases; removal cannot leave an invisible command registered. */
export class ControlInteractionBindings {
  constructor() {
    this.roots = new Map();
    this.controls = new Map();
  }

  router(context) {
    if (!this.roots.has(context.root)) this.roots.set(context.root, new KeyboardAcceleratorRouter(context.root));
    return this.roots.get(context.root);
  }

  update(context, node, element) {
    const command = sceneNode(context, node.properties.Command);
    const accelerators = [...(node.collections.KeyboardAccelerators ?? []), ...(command?.collections.KeyboardAccelerators ?? [])];
    const accessKey = node.properties.AccessKey || command?.properties.AccessKey || '';
    const tooltip = node.properties['ToolTipService.ToolTip'];
    const flyout = node.properties.ContextFlyout;
    const selectionFlyout = node.properties.SelectionFlyout;
    const signature = JSON.stringify([accessKey, tooltip, flyout, selectionFlyout,
      accelerators.map(value => sceneNode(context, value)?.properties ?? value)]);
    const previous = this.controls.get(node.id);
    if (previous?.signature === signature && previous.element === element) return;
    this.release(node.id);
    const removers = [];
    this.controls.set(node.id, { signature, element, removers });
    if (accessKey || accelerators.length) {
      const router = this.router(context);
      if (accessKey) removers.push(router.registerAccessKey(accessKey, element, () => {
        requestControlEvent(context, node, 'AccessKeyInvoked', { Handled: false }).then(args => {
          if (!args.Handled && context.nodes.has(node.id)) invokeControl(context, node, element);
        }).catch(error => context.host.options.onError?.(error));
      }));
      if (accessKey) {
        removers.push(router.on('AccessKeyDisplayRequested', args => context.emit(node, 'AccessKeyDisplayRequested', args)),
          router.on('AccessKeyDisplayDismissed', args => context.emit(node, 'AccessKeyDisplayDismissed', args)));
      }
      for (const value of accelerators) {
        const accelerator = sceneNode(context, value);
        const properties = accelerator?.properties ?? value;
        if (!properties.Key) continue;
        removers.push(router.register({ key: properties.Key, modifiers: properties.Modifiers,
          scope: properties.ScopeOwner?.$ref ? context.host.ensure(properties.ScopeOwner.$ref) : context.root,
          enabled: () => properties.IsEnabled !== false && node.properties.IsEnabled !== false && commandCanExecute(context, node),
          invoke(args) {
            if (accelerator) {
              requestControlEvent(context, accelerator, 'Invoked', { Handled: false, Element: { $ref: node.id } }).then(payload => {
                if (!payload.Handled && context.nodes.has(node.id)) invokeControl(context, node, element);
              }).catch(error => context.host.options.onError?.(error));
            } else invokeControl(context, node, element);
            args.Handled = true;
            return true;
          } }));
      }
    }
    if (typeof tooltip === 'string') {
      element.removeAttribute('title');
      const lease = attachTextToolTip(context, element, tooltip);
      removers.push(() => lease.dispose());
    }
    else {
      element.removeAttribute('title');
      const tooltipNode = sceneNode(context, tooltip);
      if (tooltipNode) {
        const lease = attachToolTip(context, element, tooltipNode);
        removers.push(() => lease.dispose());
      }
    }
    const flyoutNode = sceneNode(context, flyout);
    if (flyoutNode) this.contextMenu(context, node, element, flyoutNode, removers);
    const selectionNode = sceneNode(context, selectionFlyout);
    if (selectionNode) this.selectionMenu(context, node, element, selectionNode, removers);
  }

  selectionMenu(context, node, element, flyout, removers) {
    let disposed = false, open = false;
    const show = () => queueMicrotask(() => {
      if (disposed || open || node.properties.IsEnabled === false) return;
      const descriptor = context.host.registry.resolve(node.type), model = descriptor.getTextModel?.(context, node);
      if (!(model?.selectionLength ?? model?.selection?.length)) return;
      open = true;
      Promise.resolve(context.host.invoke(flyout.id, 'ShowAt', [{ $ref: node.id }]))
        .catch(error => context.host.options.onError?.(error)).finally(() => { open = false; });
    });
    element.addEventListener('pointerup', show);
    removers.push(() => { disposed = true; element.removeEventListener('pointerup', show); });
  }

  contextMenu(context, node, element, flyout, removers) {
    const show = event => {
      if (node.properties.IsEnabled === false || event.defaultPrevented) return;
      if (event.type === 'keydown' && !(event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      requestControlEvent(context, node, 'ContextRequested', { Handled: false,
        Position: { X: event.clientX ?? 0, Y: event.clientY ?? 0 } }).then(payload => {
        if (payload.Handled || !context.nodes.has(node.id)) {
          if (context.nodes.has(node.id)) context.emit(node, 'ContextCanceled', {});
          return;
        }
        const value = context.host.invoke(flyout.id, 'ShowAt', [{ $ref: node.id }]);
        return value ?? showControlOverlay(context, flyout, { target: element });
      }).catch(error => context.host.options.onError?.(error));
    };
    element.addEventListener('contextmenu', show);
    element.addEventListener('keydown', show);
    removers.push(() => element.removeEventListener('contextmenu', show), () => element.removeEventListener('keydown', show));
  }

  release(id) {
    const state = this.controls.get(id);
    if (!state) return;
    for (const remove of state.removers) remove();
    this.controls.delete(id);
  }

  dispose() {
    for (const id of this.controls.keys()) this.release(id);
    for (const router of this.roots.values()) router.dispose();
    this.roots.clear();
  }
}
