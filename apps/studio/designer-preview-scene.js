import {projectDesignerAuthoringScene} from '@sharpforge/designer';

/** Appearance belongs after value-source resolution; temporary colors must never become model locals. */
export function buildDesignerPreviewScene(view) {
  const environment = view.surface.preview.environment;
  const theme = environment.value.contrast === 'high' ? 'highContrast' : environment.value.theme;
  const options = {theme, samples: true, resolveAsset: uri => view.assetPreviews.resolve(uri)};
  const scene = projectDesignerAuthoringScene(view.document.value,
    view.surface.scene(view.document.value, {appearance: false}), options);
  const composed = view.projectRoots?.project(view.document.value, scene, options).scene ?? scene;
  return environment.applyToScene(composed);
}
