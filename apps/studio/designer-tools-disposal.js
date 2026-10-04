import {releaseAppResources} from './designer-app-host-errors.js';

/** Release every tool resource in ownership order; aggregate failures after the remaining resources have closed. */
export function disposeDesignerTools(view) {
  if (view.disposed) return;
  view.disposed = true;
  const resources = [view.updates, view.liveAttachment, view.surface, view.accessibility, view.outline, view.toolbox,
    view.properties, view.resources, view.resourceGallery, view.resourceContext, view.options, view.assetPreviewController,
    view.assetPreviews, view.chrome, view.treeView, view.host];
  releaseAppResources([
    () => view.modelSubscription?.(),
    () => view.resizeObserver?.disconnect(),
    ...resources.map(resource => () => resource?.dispose?.()),
    () => view.menu?.close(),
    () => { if (view.ownsSession) view.session.dispose(); }
  ]);
}
