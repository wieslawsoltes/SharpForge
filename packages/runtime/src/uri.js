import {ManagedFault} from './heap.js';

function constructUri(platform, text, base) {
  let url;
  try {url = new URL(text, base);}
  catch {throw new ManagedFault('UriFormatException', 'Invalid absolute URI');}
  // Parsing errors are URI errors; allocation or lifetime faults must preserve their own managed identity.
  const original = text == null ? null : platform.heap.string(String(text));
  return platform.heap.withRoots([original], () => {
    const absolute = platform.heap.string(url.href);
    return platform.make('System.Uri', {$original: original, $absolute: absolute});
  });
}

function escapeUri(name, text) {
  try {
    return name === 'EscapeDataString'
      ? encodeURIComponent(text).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
      : decodeURIComponent(text);
  } catch (error) {throw new ManagedFault('UriFormatException', error.message);}
}

/** URI invocation returns only the selected property, with no unrooted intermediate managed strings. */
export function invokeUri(platform, descriptor, reference, values, native) {
  if (descriptor.kind === 'constructor') {
    const base = values.length === 1 ? undefined : platform.native(platform.get(values[0], '$absolute'));
    return constructUri(platform, native.at(-1), base);
  }
  if (descriptor.isStatic) return platform.heap.string(escapeUri(descriptor.name, native[0]));
  const original = platform.get(reference, '$original'), absolute = platform.get(reference, '$absolute');
  if (descriptor.name === 'ToString') return absolute ?? original;
  if (descriptor.property === 'OriginalString') return original;
  if (descriptor.property === 'IsAbsoluteUri') return platform.managed(absolute !== null, 'bool');
  if (!absolute) throw new ManagedFault('InvalidOperationException', 'This operation requires an absolute URI');
  if (descriptor.property === 'AbsoluteUri') return absolute;
  const url = new URL(platform.native(absolute));
  if (descriptor.property === 'Port') return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : -1;
  const text = {AbsolutePath: url.pathname, Host: url.hostname, Scheme: url.protocol.slice(0, -1)}[descriptor.property];
  return text === undefined ? undefined : platform.heap.string(text);
}
