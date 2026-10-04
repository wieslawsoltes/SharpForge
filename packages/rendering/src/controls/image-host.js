import {ImageCache} from '../media/images.js';

/** Native image loading supplies layout/accessibility while decoded resources feed all retained renderers. */
export function registerImageHostRenderer(registry, renderer) {
  const legacy = registry.resolve('Image');
  if (!legacy) return registry;
  const cache = renderer.imageCache ??= new ImageCache({decode: renderer.document.defaultView.createImageBitmap?.bind(renderer.document.defaultView)});
  registry.register('Image', {...legacy, create(context) {
    const element = context.document.createElement('div'); element.setAttribute('role', 'img'); return element;
  }, render(context, node, element) {
    const state = context.getState(node, () => ({}));
    if (!state.nativeImage) {
      state.nativeImage = context.document.createElement('img'); state.nativeImage.setAttribute('aria-hidden', 'true');
      Object.assign(state.nativeImage.style, {width: '100%', height: '100%', display: 'block'});
      state.imageGeneration = 0;
      const loaded = async () => {
        const generation = ++state.imageGeneration;
        let lease;
        try {
          lease = await cache.acquire(state.nativeImage, {key: state.nativeImage.currentSrc || state.nativeImage.src});
          if (state.disposed || generation !== state.imageGeneration) { lease.release(); return; }
          if (state.imageHandle) renderer.resources.release(state.imageHandle);
          state.imageHandle = renderer.resources.register('image', lease.image, {dispose: lease.release});
          node.properties.NaturalWidth = lease.image.width; node.properties.NaturalHeight = lease.image.height;
          state.imageReady = true; context.invalidate(node.id, 'measure');
          context.emit(node, 'ImageOpened');
        } catch (error) {
          lease?.release(); state.imageError = error.message; state.imageReady = false;
          context.emit(node, 'ImageFailed', {message: error.message}); context.invalidate(node.id, 'render');
        }
      };
      const failed = () => {
        state.imageReady = false; state.imageGeneration++;
        state.imageError = 'Native image decoding failed';
        context.emit(node, 'ImageFailed', {message: state.imageError}); context.invalidate(node.id, 'render');
      };
      state.nativeImage.addEventListener('load', loaded);
      state.nativeImage.addEventListener('error', failed);
      state.dispose = () => {
        state.disposed = true; state.imageGeneration++; state.nativeImage.removeEventListener('load', loaded);
        state.nativeImage.removeEventListener('error', failed);
        if (state.imageHandle) renderer.resources.release(state.imageHandle); state.imageHandle = null;
      };
    }
    const source = node.properties.Source;
    if (state.imageSource !== source) {
      state.imageSource = source; state.imageReady = false; state.imageGeneration++;
      if (state.imageHandle) renderer.resources.release(state.imageHandle); state.imageHandle = null;
      state.nativeImage.style.visibility = 'visible';
    }
    const resolved = source?.$ref ? context.resolve(source.$ref)?.properties : source?.properties ?? source;
    if (resolved?.pixels || resolved?.source) {
      state.imageReady = true; state.nativeImage.removeAttribute('src');
      node.properties.NaturalWidth = resolved.width ?? resolved.PixelWidth;
      node.properties.NaturalHeight = resolved.height ?? resolved.PixelHeight;
    } else legacy.render?.(context, {...node, properties: {...node.properties, Source: resolved?.UriSource ?? source}}, state.nativeImage);
    element.setAttribute('aria-label', state.nativeImage.alt || node.properties.Name || 'Image');
    if (state.nativeImage.parentNode !== element) element.append(state.nativeImage);
  }}, {override: true});
  return registry;
}
