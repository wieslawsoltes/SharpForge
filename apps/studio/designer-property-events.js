import {
  DesignerAuthoringError, compatibleDesignerHandlers, designerEventHandlerRequest, designerEventSourceAccess, setDesignerEventHandler
} from '../../packages/designer/src/index.js';
import {eventsFor} from '../../packages/framework/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect, runPropertyAction} from './designer-property-dom.js';
import {activateDesignerEvent, bindDesignerEventActivation} from './designer-event-actions.js';

function eventSource(controller, id, event) {
  if (controller.view.resources?.scope) return {capability: 'navigate', reason: 'template'};
  const analysis = controller.view.sourceSync?.session?.analysis;
  const binding = analysis?.bindings?.[id]?.events?.[event];
  return analysis?.readOnly ? {...binding, capability: 'navigate', reason: 'readOnly'} : binding;
}

function eventAccess(controller, id, event) {
  return designerEventSourceAccess(eventSource(controller, id, event), {uri: controller.view.sourceSync?.session?.analysis?.uri});
}

export function renderDesignerEvents(controller, parent) {
  const model = controller.modelDocument;
  const node = model.node();
  const document = parent.ownerDocument;
  if (!node || model.selection.length !== 1) {
    parent.append(propertyElement(document, 'p', 'Select one control to edit its managed events.'));
    return;
  }
  for (const event of Object.keys(eventsFor(node.type)).sort()) {
    const root = propertyElement(document, 'div', '', 'design-event-row');
    root.dataset.designerEvent = event;
    const error = propertyElement(document, 'p', '', 'design-editor-error');
    error.hidden = true;
    bindDesignerEventActivation(root, () => runPropertyAction(() => activateDesignerEvent(controller.view, node.id, event), error));
    const available = controller.view.sourceSync?.handlerCandidates?.(node, event) ?? controller.view.designerHandlers?.(node, event) ?? [];
    const candidates = compatibleDesignerHandlers(node.type, event, available);
    const access = eventAccess(controller, node.id, event);
    const choices = [{label: '(No handler)', value: ''}, ...candidates.map(handler => ({value: handler.name, label: handler.name}))];
    if (node.events[event] && !candidates.some(handler => handler.name === node.events[event])) {
      choices.push({value: node.events[event], label: node.events[event] + ' (current source handler)'});
    }
    const select = propertySelect(document, choices, node.events[event] ?? '', event + ' handler');
    select.disabled = !access.editable;
    select.dataset.designEvent = event;
    select.addEventListener('change', () => runPropertyAction(() =>
      setDesignerEventHandler(model, node.id, event, select.value, {handlers: available, sourceBinding: eventSource(controller, node.id, event)}), error));
    const candidate = candidates.find(handler => handler.name === select.value);
    const canNavigate = access.canNavigate && typeof controller.view.sourceSync?.navigateEvent === 'function' ||
      candidate?.uri && typeof controller.view.openSource === 'function';
    root.append(propertyField(document, event, select),
      propertyButton(document, 'New…', () => runPropertyAction(() => openNewHandler(controller, node, event), error),
        {disabled: !access.editable || typeof controller.view.sourceSync?.createEventHandler !== 'function'}),
      propertyButton(document, 'Go to', () => runPropertyAction(() => {
        if (eventAccess(controller, node.id, event).canNavigate && typeof controller.view.sourceSync?.navigateEvent === 'function') {
          return controller.view.sourceSync.navigateEvent(node.id, event);
        }
        if (candidate?.uri) return controller.view.openSource(candidate.uri, candidate.start ?? 0);
        throw new DesignerAuthoringError('SFD1842', 'No current source location is available for this event.');
      }, error), {disabled: !canNavigate}), error);
    if (!access.editable) {
      root.append(propertyElement(document, 'small', access.reason));
      for (const subscription of access.subscriptions) root.append(propertyElement(document, 'small', subscription.handler || '(lambda)'));
    }
    parent.append(root);
  }
  parent.append(propertyElement(document, 'p',
    'Existing methods are filtered by the event delegate signature. New handlers use the source editor transaction.'));
}

function openNewHandler(controller, node, event) {
  const access = eventAccess(controller, node.id, event);
  if (!access.editable) throw new DesignerAuthoringError('SFD1842', access.reason);
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Create ' + event + ' handler');
  const name = propertyInput(document, {value: (node.properties.Name || node.id) + '_' + event, label: 'Handler name'});
  modal.body.append(propertyField(document, 'Method', name));
  modal.footer.append(propertyButton(document, 'Create and subscribe', () => modal.run(async () => {
    const analysis = controller.view.sourceSync?.session?.analysis;
    const className = analysis?.ownership?.className ?? analysis?.method?.owner ?? analysis?.className ?? 'Program';
    const request = designerEventHandlerRequest(node, event, name.value, {className, sourceBinding: eventSource(controller, node.id, event)});
    const result = await controller.view.sourceSync.createEventHandler(request);
    if (!result || result.ok === false) throw new Error(result?.message ?? 'The source service did not commit the event handler.');
    modal.close();
  })));
}
