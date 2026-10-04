import {designerSidePanelIds} from './designer-document-view.js';

/** Moves only each session's panel roots; inactive trees, property edits, and subscriptions stay with their owner. */
export class DesignerToolRouter {
  constructor({registry, resolveTarget, resolveView}) {
    this.registry = registry;
    this.resolveTarget = resolveTarget;
    this.resolveView = resolveView;
    this.disposed = false;
    this.unsubscribe = registry.subscribe(event => {
      if (['active', 'close', 'restore'].includes(event.kind)) this.route(registry.active);
    });
    this.route(registry.active);
  }

  route(session) {
    if (this.disposed) return;
    const candidate = session ? this.resolveView(session.uri) : null;
    const view = candidate?.initializationFailed ? null : candidate;
    for (const id of designerSidePanelIds) {
      const target = this.resolveTarget(id);
      if (!target) continue;
      const content = view?.panels.get(id);
      if (content) {
        if (target.firstElementChild !== content) target.replaceChildren(content);
        target.dataset.designerUri = session.uri;
        target.removeAttribute('aria-disabled');
      } else {
        delete target.dataset.designerUri;
        target.setAttribute('aria-disabled', 'true');
        const empty = target.ownerDocument.createElement('div');
        empty.className = 'designer-document-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = 'Open a compatible C# or design document to use designer tools.';
        target.replaceChildren(empty);
      }
    }
    view?.tools?.flushVisiblePanels?.();
  }

  dispose() {
    if (this.disposed) return;
    this.route(null);
    this.disposed = true;
    this.unsubscribe();
  }
}
