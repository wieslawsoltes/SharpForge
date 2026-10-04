import { WebViewSession } from './webview.js';
import { MediaPlayerSession } from './media-player.js';
import { InkStrokeModel } from './platform.js';
import { registerPlayerAdapters } from './player-adapters.js';
import { CONTROLS as C, XAML as X, read, registerMethod, registerGet, registerSet, invokeHost, unsupported } from '../policy/adapter-helpers.js';

const imaging = X + 'Media.Imaging.';

export function managedWebView(context, receiver) {
  return context.state(receiver, 'family.webview', () => {
    const model = new WebViewSession({ policy: context.services.permissions });
    for (const name of ['NavigationStarting', 'NavigationCompleted']) model.on(name, args => context.emit(receiver, name, args));
    return model;
  });
}

function publishWebView(context, receiver, model) {
  context.write(receiver, 'Source', model.source); context.write(receiver, 'Html', model.html);
  context.write(receiver, 'CanGoBack', model.canGoBack); context.write(receiver, 'CanGoForward', model.canGoForward);
}

export function managedMedia(context, receiver) {
  const model = context.state(receiver, 'family.media', () => {
    const value = new MediaPlayerSession({ policy: context.services.permissions,
      backend: { play: () => invokeHost(context, receiver, 'Play', [true]), pause: () => invokeHost(context, receiver, 'Pause', []) } });
    for (const name of ['MediaFailed', 'PlaybackStateChanged', 'PositionChanged']) value.on(name, args => context.emit(receiver, name, args));
    return value;
  });
  const source = read(context, receiver, 'Source', '');
  if (source !== model.source) model.setSource(source);
  return model;
}

export function registerMediaAdapters(registry) {
  registerPlayerAdapters(registry);
  registerMethod(registry, imaging + 'SvgImageSource', '.ctor', (c, r, args) =>
    c.allocate(imaging + 'SvgImageSource', { UriSource: String(c.native(args[0] ?? '')) }), { kind: 'constructor' });
  registerMethod(registry, imaging + 'WriteableBitmap', 'SetPixels', (context, receiver, args) => {
    const model = context.model(receiver);
    const pixels = Uint8Array.from(context.items(args[0]).map(value => context.native(value)));
    if (pixels.length !== model.pixels?.length) {
      throw Object.assign(new Error('RGBA pixel buffer size does not match the bitmap'), { code: 'SFUI16B2' });
    }
    model.setPixels(pixels);
    const shared = context.state(receiver, 'pixelBuffer');
    if (shared) {
      const values = context.items(shared);
      for (let index = 0; index < pixels.length; index++) values[index] = context.managed(pixels[index], 'byte');
    }
    context.services.invalidateRendering?.(receiver);
  });
  registerMethod(registry, C + 'Image', 'SetSource', (c, r, args) => c.write(r, 'ImageSource', args[0]));
  registerSet(registry, C + 'WebView2', 'Source', (c, r, value) => {
    const model = managedWebView(c, r);
    if (model.navigate(String(c.native(value)))) publishWebView(c, r, model);
  });
  registerMethod(registry, C + 'WebView2', 'NavigateToString', (c, r, args) => {
    const model = managedWebView(c, r); model.navigateToString(String(c.native(args[0]))); publishWebView(c, r, model);
  });
  for (const [name, method] of [['GoBack', 'goBack'], ['GoForward', 'goForward']]) registerMethod(registry, C + 'WebView2', name,
    (c, r) => { const model = managedWebView(c, r); model[method](); publishWebView(c, r, model); });
  registerGet(registry, C + 'WebView2', 'CanGoBack', (c, r) => managedWebView(c, r).canGoBack);
  registerGet(registry, C + 'WebView2', 'CanGoForward', (c, r) => managedWebView(c, r).canGoForward);
  registerMethod(registry, C + 'WebView2', 'ExecuteScriptAsync', (c, r) => c.task(
    Promise.resolve().then(() => managedWebView(c, r).executeScriptAsync()), { resultType: 'string' }));
  registerMethod(registry, C + 'MediaPlayerElement', 'PlayAsync', (c, r) =>
    c.task(managedMedia(c, r).play(), { resultType: 'bool' }));
  registerMethod(registry, C + 'MediaPlayerElement', 'Pause', (c, r) => managedMedia(c, r).pause());
  registerMethod(registry, C + 'MediaPlayerElement', 'Seek', (c, r, args) => {
    const model = managedMedia(c, r), position = Number(c.native(args[0])); model.seek(position); invokeHost(c, r, 'Seek', [model.position]);
  });
  registerMethod(registry, C + 'InkCanvas', 'Clear', (c, r) => {
    const model = c.state(r, 'family.ink', () => new InkStrokeModel()); model.clear(); invokeHost(c, r, 'Clear', []);
  });
  registerMethod(registry, C + 'AnimatedVisualPlayer', 'PlayAsync', (c, r, args) =>
    c.task(Promise.resolve(invokeHost(c, r, 'Play', args.map(value => c.native(value)))), { resultType: 'void' }));
  for (const name of ['Pause', 'Resume']) registerMethod(registry, C + 'AnimatedVisualPlayer', name,
    (c, r) => { invokeHost(c, r, name, []); });
  for (const name of ['MapControl', 'CaptureElement']) registerMethod(registry, C + name, '.ctor', (context) => {
    if (!context.services.platform?.[name]?.attach) unsupported(name);
    return context.allocate(C + name, {});
  }, { kind: 'constructor' });
}
