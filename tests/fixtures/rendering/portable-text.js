import {readFile} from 'node:fs/promises';
import {bundledTextFixtures} from '../../../packages/rendering/src/text/bundled-fixtures.js';
import {createPortableTextProvider} from '../../../packages/rendering/src/text/portable-provider.js';

export const portableFixtureRoot = new URL('../../../', import.meta.url);

/** Metadata/API recorder only. Actual decoded pixels are verified by the real-browser numeric text corpus. */
export async function pngHeaderRecorder(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {width: view.getUint32(16), height: view.getUint32(20), close() { this.closed = true; }};
}

export function portableText(options = {}) {
  return createPortableTextProvider({...bundledTextFixtures(portableFixtureRoot), loadBinary: url => readFile(new URL(url)),
    decodeImage: pngHeaderRecorder, ...options});
}
