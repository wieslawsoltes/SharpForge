import { registerImageRenderers } from './image-renderer.js';
import { registerWebViewRenderer } from './webview.js';
import { registerMediaPlayerRenderer } from './media-player.js';
import { registerPlatformRenderers } from './platform.js';

export { BitmapImage, WriteableBitmap, drawNineGrid } from './image-source.js';
export { WebViewSession } from './webview.js';
export { MediaPlayerSession } from './media-player.js';
export { PlatformControlSession, InkStrokeModel } from './platform.js';
export { resolveImageSource, personInitials } from './image-renderer.js';

export function registerMediaRenderers(registry) {
  registerImageRenderers(registry); registerWebViewRenderer(registry);
  registerMediaPlayerRenderer(registry); registerPlatformRenderers(registry);
}
