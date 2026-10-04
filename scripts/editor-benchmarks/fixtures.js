import { validateFixtureSize } from './limits.js';

export const searchMarker = 'SHARPFORGE_BENCHMARK_TARGET';
const sourceLine = 'int value = 1234; // deterministic editor benchmark source, ordinary ASCII text\n';

/** ASCII fixtures have equal UTF-8 byte and UTF-16 code-unit counts, making requested sizes exact. */
export function createEditorFixture(sizeBytes) {
  validateFixtureSize(sizeBytes);
  const repeated = sourceLine.repeat(Math.ceil(sizeBytes / sourceLine.length)).slice(0, sizeBytes);
  const markerOffset = Math.floor(sizeBytes / 2);
  const text = repeated.slice(0, markerOffset) + searchMarker + repeated.slice(markerOffset + searchMarker.length);
  return { uri: `benchmark-${sizeBytes}.cs`, text, sizeBytes, markerOffset, marker: searchMarker };
}

export function pasteFixture(size = 64 * 1024) {
  const line = '// pasted source fixture\n';
  return line.repeat(Math.ceil(size / line.length)).slice(0, size);
}
