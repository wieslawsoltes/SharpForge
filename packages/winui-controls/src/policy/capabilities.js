import { ControlError } from './events.js';

/** Explicit per-application grants. Constructing a control never requests permission. */
export class HostPermissionPolicy {
  constructor({ origins = [], request = async () => false, capabilities = {} } = {}) {
    this.origins = new Set(origins.map(origin => new URL(origin).origin));
    this.request = request;
    this.capabilities = { ...capabilities };
  }

  url(value, { capability = 'navigate', image = false } = {}) {
    if (typeof value !== 'string' || value.length > 8 * 1024 * 1024) {
      throw new ControlError('SFUI1630', 'Invalid resource URI');
    }
    if (image && /^(?:blob:|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(value)) return value;
    let uri;
    try { uri = new URL(value); }
    catch { throw new ControlError('SFUI1630', 'An absolute resource URI is required'); }
    if (!['https:', 'http:'].includes(uri.protocol) || uri.username || uri.password) {
      throw new ControlError('SFUI1631', 'The resource URI scheme is not permitted', { capability });
    }
    if (!this.origins.has(uri.origin)) {
      throw new ControlError('SFUI1632', 'The resource origin has not been granted', { capability, origin: uri.origin });
    }
    return uri.href;
  }

  async authorize(capability, details = {}, { signal } = {}) {
    signal?.throwIfAborted();
    const granted = await this.request(Object.freeze({ capability, ...details, signal }));
    signal?.throwIfAborted();
    return granted === true;
  }

  require(capability) {
    const adapter = this.capabilities[capability];
    if (!adapter) throw new ControlError('SFUI1633', 'Platform capability is unavailable', { capability });
    return adapter;
  }
}

export const platformControlPolicy = Object.freeze({
  WebView2: { backend: 'sandboxed-iframe', unsupported: ['CoreWebView2', 'ExecuteScriptAsync', 'native-process-control'] },
  MediaPlayerElement: { backend: 'HTMLMediaElement', unsupported: ['DRM-license-management', 'native-codec-installation'] },
  MapControl: { backend: 'host-adapter', unsupported: ['built-in-map-service', 'implicit-provider-credentials'] },
  InkCanvas: { backend: 'pointer-ink', unsupported: ['native-handwriting-recognition'] },
  CaptureElement: { backend: 'host-media-stream', unsupported: ['implicit-camera-grant', 'native-device-controls'] },
  AnimatedVisualPlayer: { backend: 'host-animation-adapter', unsupported: ['built-in-Lottie-decoder'] },
  AnimatedIcon: { backend: 'host-animation-adapter', unsupported: ['WinUI-composition-animation-binary'] },
  WriteableBitmap: { backend: 'RGBA-pixel-buffer', unsupported: ['native-bitmap-lock'] }
});

/** Avoid exposing document text, URIs or credentials in a failed-capability diagnostic. */
export function reportControlFailure(context, node, error) {
  const diagnostic = { code: error.code ?? 'SFUI1699', message: error.message, control: node.id };
  context.host.options.onError?.(Object.assign(new Error(diagnostic.message), diagnostic));
  return diagnostic;
}
