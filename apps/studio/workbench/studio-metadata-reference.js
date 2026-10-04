import { metadataLimits, metadataError } from './metadata/limits.js';
import { abortError } from './events.js';

/** Read a referenced PE through the captured workspace backend; parsing runs in the metadata worker. */
export function createStudioMetadataReader({ state, nativeBuild }) {
  return async (descriptor, { signal } = {}) => {
    const current = state(), epoch = current.workspaceEpoch, native = current.nativeMode;
    const disk = current.disk, client = nativeBuild()?.client;
    const check = () => {
      signal?.throwIfAborted();
      const next = state();
      if (next.workspaceEpoch !== epoch || next.nativeMode !== native ||
          (native ? nativeBuild()?.client !== client : next.disk !== disk)) {
        throw abortError('The workspace changed while reading assembly metadata');
      }
    };
    check();
    let bytes;
    if (native) {
      if (!client) throw metadataError('METADATA_REFERENCE_UNAVAILABLE', 'The native workspace is not connected');
      bytes = await client.binary(descriptor.path, { signal });
    } else {
      const handle = disk?.handles.get(descriptor.path);
      if (!handle) throw metadataError('METADATA_REFERENCE_UNAVAILABLE', 'Open the folder containing reference ' + descriptor.name);
      const file = await handle.getFile();
      check();
      if (file.size > metadataLimits.bytes) throw metadataError('METADATA_BYTES_LIMIT', 'Referenced assembly exceeds the inspection limit');
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    check();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > metadataLimits.bytes) {
      throw metadataError('METADATA_BYTES_LIMIT', 'Referenced assembly exceeds the inspection limit');
    }
    return bytes;
  };
}
