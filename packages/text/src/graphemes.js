import { unicodeGraphemeSegments } from './grapheme/state.js';
export { unicodeGraphemeVersion } from './grapheme/properties.js';

/** Reusable Unicode 16.0 segmentation; an explicitly supplied Intl/custom segmenter can override the pinned profile. */
export class GraphemeSegmenter {
  constructor({ segmenter = null } = {}) { this.segmenter = segmenter; }
  *segments(text) {
    if (typeof text !== 'string') throw new TypeError('Expected text');
    if (!this.segmenter) { yield* unicodeGraphemeSegments(text); return; }
    for (const item of this.segmenter.segment(text)) {
      yield { segment: item.segment, index: item.index, end: item.index + item.segment.length };
    }
  }
  next(text, offset) {
    offset = Math.max(0, Math.min(text.length, Math.trunc(offset)));
    if (offset === text.length) return offset;
    if (this.segmenter) {
      const item = this.segmenter.segment(text).containing(offset);
      return item.index + item.segment.length;
    }
    for (const item of this.segments(text)) if (item.end > offset) return item.end;
    return text.length;
  }
  previous(text, offset) {
    offset = Math.max(0, Math.min(text.length, Math.trunc(offset)));
    if (offset === 0) return 0;
    if (this.segmenter) return this.segmenter.segment(text).containing(offset - 1).index;
    for (const item of this.segments(text)) if (item.end >= offset) return item.index;
    return 0;
  }
}

function service(options) { return options?.segmenter instanceof GraphemeSegmenter ? options.segmenter : new GraphemeSegmenter(options); }

/** Iterate clusters with UTF-16 start/end offsets. Pass a service instance for repeated hot-path calls. */
export function iterateGraphemes(text, options) { return service(options).segments(text); }
export function graphemeSegments(text, options) { return Array.from(iterateGraphemes(text, options)); }
export function nextGraphemeOffset(text, offset, options) { return service(options).next(text, offset); }
export function previousGraphemeOffset(text, offset, options) { return service(options).previous(text, offset); }
