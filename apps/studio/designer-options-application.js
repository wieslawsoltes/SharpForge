import {updateGuideSettings} from '@sharpforge/designer';

/** Explicit Apply now updates the active guide model and the real synchronization controller. */
export function applyDesignerOptions(view) {
  const service = view.designerOptions;
  if (!service) throw new Error('Designer settings service is unavailable.');
  view.cancelSurfaceEdits?.();
  updateGuideSettings(view.document, {gridSize: service.value.snap});
  service.applyToNewDocument(view);
  view.chrome?.setMode(service.value.defaultView);
  view.documentHost?.setSplitOrientation?.(service.value.splitOrientation);
  view.resizeArtboard();
}
