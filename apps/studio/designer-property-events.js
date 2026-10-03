import {compatibleDesignerHandlers, designerEventHandlerRequest, setDesignerEventHandler} from '../../packages/designer/src/index.js';
import {eventsFor} from '../../packages/framework/src/index.js';
import {propertyButton, propertyDialog, propertyElement, propertyField, propertyInput, propertySelect, runPropertyAction} from './designer-property-dom.js';

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
    const error = propertyElement(document, 'p', '', 'design-editor-error');
    error.hidden = true;
    const available = controller.view.sourceSync?.handlerCandidates?.(node, event) ?? controller.view.designerHandlers?.(node, event) ?? [];
    const candidates = compatibleDesignerHandlers(node.type, event, available);
    const choices = [{label: '(No handler)', value: ''}, ...candidates.map(handler => ({value: handler.name, label: handler.name}))];
    if (node.events[event] && !candidates.some(handler => handler.name === node.events[event])) {
      choices.push({value: node.events[event], label: node.events[event] + ' (current source handler)'});
    }
    const select = propertySelect(document, choices, node.events[event] ?? '', event + ' handler');
    select.addEventListener('change', () => runPropertyAction(() =>
      setDesignerEventHandler(model, node.id, event, select.value, available), error));
    root.append(propertyField(document, event, select),
      propertyButton(document, 'New…', () => openNewHandler(controller, node, event),
        {disabled: typeof controller.view.sourceSync?.createEventHandler !== 'function'}),
      propertyButton(document, 'Go to', () => runPropertyAction(() => {
        const candidate = candidates.find(handler => handler.name === select.value);
        if (candidate?.uri) return controller.view.openSource(candidate.uri, candidate.start ?? 0);
        return controller.view.sourceSync?.navigateEvent?.(node.id, event);
      }, error), {disabled: !node.events[event]}), error);
    parent.append(root);
  }
  parent.append(propertyElement(document, 'p', 'Existing methods are filtered by the event delegate signature. New handlers use the source editor transaction.'));
}

function openNewHandler(controller, node, event) {
  const document = controller.panel.ownerDocument;
  const modal = propertyDialog(document, 'Create ' + event + ' handler');
  const name = propertyInput(document, {value: (node.properties.Name || node.id) + '_' + event, label: 'Handler name'});
  modal.body.append(propertyField(document, 'Method', name));
  modal.footer.append(propertyButton(document, 'Create and subscribe', () => modal.run(async () => {
    const request = designerEventHandlerRequest(node, event, name.value, {
      className: controller.view.sourceSync?.session?.analysis?.className ?? 'Program'
    });
    const result = await controller.view.sourceSync.createEventHandler(request);
    if (!result || result.ok === false) throw new Error(result?.message ?? 'The source service did not commit the event handler.');
    modal.close();
  })));
}
