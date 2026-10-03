import {DesignerAuthoringError, designerMetadata} from '@sharpforge/designer';
import {eventsFor} from '@sharpforge/framework';

/** The single designer metadata capability determines whether a control has a default event. */
export function defaultDesignerEvent(view, nodeId) {
  const node = view.document.node(nodeId);
  if (!node || view.templateScope || view.resources?.scope) return null;
  return designerMetadata.find(type => type.type === node.type)?.defaultEvent ?? null;
}

/** Both surface and event rows use the same compiler-owned create-or-navigate transaction. */
export async function activateDesignerEvent(view, nodeId, eventName) {
  const node = view.document.node(nodeId);
  if (!node || !Object.hasOwn(eventsFor(node.type), eventName)) {
    throw new DesignerAuthoringError('SFD1842', 'Select a control with a supported managed event.');
  }
  if (view.templateScope || view.resources?.scope) {
    throw new DesignerAuthoringError('SFD1842', 'Managed event edits on template parts require Code view.');
  }
  const sync = view.sourceSync;
  const analysis = sync?.session?.analysis;
  const binding = analysis?.bindings?.[nodeId]?.events?.[eventName];
  if (binding?.subscriptions?.length) {
    if (typeof sync.navigateEvent !== 'function') throw new DesignerAuthoringError('SFD1842', 'Source navigation is unavailable.');
    return sync.navigateEvent(nodeId, eventName);
  }
  if (analysis?.readOnly || view.state?.readOnly) {
    throw new DesignerAuthoringError('SFD1842', 'This source preview is read-only. Existing handlers can be opened in Code view.');
  }
  if (!analysis || typeof sync.createEventHandler !== 'function') {
    throw new DesignerAuthoringError('SFD1842', 'Connect a C# document before creating a managed event handler.');
  }
  const result = await sync.createEventHandler({nodeId, event: eventName});
  if (!result || result.ok === false) {
    throw new DesignerAuthoringError('SFD1842', result?.message ?? 'The source service did not commit the event handler.');
  }
  return result;
}

/** Inner editor gestures retain their own semantics; row labels and keyboard activation open the event. */
export function bindDesignerEventActivation(row, activate) {
  row.tabIndex = 0;
  row.title = 'Double-click or press Enter to create or open the event handler';
  const run = event => {
    event.preventDefault();
    event.stopPropagation();
    return activate();
  };
  row.addEventListener('dblclick', event => {
    if (!event.target.closest('button,input,select,textarea,[contenteditable="true"]')) return run(event);
  });
  row.addEventListener('keydown', event => {
    if (event.target === row && event.key === 'Enter') return run(event);
  });
}
