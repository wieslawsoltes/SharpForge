import { AutomationTree, AutomationMemberService, getControlFamilyModel, invokeManagedAutomationAction, AutomationStatePublisher } from '@sharpforge/winui-controls';
import { ManagedFault } from '../heap.js';
import { resolveManagedUIMethod } from './virtual-methods.js';

const shape = value => value == null ? null : { width: value.ViewportWidth, height: value.ViewportHeight,
  extentWidth: value.ExtentWidth, extentHeight: value.ExtentHeight, left: value.HorizontalOffset, top: value.VerticalOffset };

/** A DOM-free host view over the existing managed layout and control models. */
function managedAutomationHost(context, layout, options) {
  const model = (node, kind) => getControlFamilyModel(context, context.reference(node.id), kind);
  const host = {
    options: { onAutomationEvent: options.onEvent, onError: options.onError },
    rootKey: options.rootKey ?? 'managed', frameworkType: context.frameworkRegistry.frameworkType,
    get nodes() { return layout.nodes; }, get windows() { return layout.windows; },
    get worldLayout() { return layout.worldLayout; }, get focusManager() { return layout.focusManager; },
    get layoutEngine() { return layout.engine; },
    services: { text: options.text ?? context.services.automationText,
      getTextModel: node => model(node, /RichEditBox|RichTextBlock/.test(node.type) ? 'richText' : 'text'),
      getSelectionModel: node => model(node, 'selection'), getTreeModel: node => model(node, 'tree'),
      getScrollMetrics: node => shape(layout.getScrollMetrics(node.id)),
      getAutomationItems: node => options.getAutomationItems?.(context.reference(node.id)) ?? [] },
    parentOf: id => layout.engine.states.get(id)?.parent ?? null,
    visualChildren: node => layout.engine.states.get(node.id)?.children ?? [],
    getLayout: id => layout.getLayout(id),
    invoke: (id, name, args) => invokeManagedAutomationAction(context, context.reference(id), name, args,
      { layout, requestHost: context.services.controls?.invoke }),
    flush: () => layout.synchronize(),
    invalidate: () => options.invalidate?.()
  };
  return host;
}

/** Member calls and custom peer overrides are synchronous in source, reloaded images, and CIL. */
export function createManagedAutomationServices(context, options = {}) {
  return context.state(null, 'automationService', () => {
    const layout = options.layout ?? context.services.layout;
    if (!layout?.engine || !layout?.synchronize) {
      throw new ManagedFault('NotSupportedException', 'SFAX017: Managed automation requires the shared layout service');
    }
    const host = managedAutomationHost(context, layout, options);
    const tree = new AutomationTree(host, { schedule: options.schedule, onError: options.onError, onEvent: event => {
      options.onEvent?.(event);
      (options.send ?? (command => context.platform.command(command)))({ op: 'automationEvent', id: event.id, event });
    } });
    const callVirtual = (receiver, name, args) => {
      if (!resolveManagedUIMethod(context, receiver, name, args.length)) return { handled: false, value: null };
      return { handled: true, value: context.invokeVirtual(receiver, name, args) };
    };
    callVirtual.hasOverride = (receiver, name, count) => !!resolveManagedUIMethod(context, receiver, name, count);
    const service = new AutomationMemberService(context, { tree, ownsTree: true, synchronize: owner => layout.synchronize(owner),
      callVirtual, publish: options.publish });
    const publisher = new AutomationStatePublisher(service, options.send ?? (command => context.platform.command(command)));
    service.publisher = publisher;
    service.publishTree = () => publisher.publishTree();
    host.invalidate = () => { options.invalidate?.(); publisher.publishTree(); };
    return service;
  });
}
