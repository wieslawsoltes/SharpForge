import {DrawingError} from '../drawing/commands.js';

/** Atlas edits append immutable glyph regions; all dirty rectangles are validated before queue writes. */
export function uploadAtlasChanges(queue, texture, image) {
  const rectangles = image.dirtyRects?.length ? image.dirtyRects : [[0, 0, image.width, image.height]];
  if (!Array.isArray(rectangles) || rectangles.length > 128 || !image.source) {
    throw new DrawingError('SFRENDER134', 'Invalid atlas upload regions');
  }
  for (const rect of rectangles) {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isInteger)
      || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0
      || rect[0] + rect[2] > image.width || rect[1] + rect[3] > image.height) {
      throw new DrawingError('SFRENDER134', 'Atlas upload rectangle is outside its source');
    }
  }
  for (const [x, y, width, height] of rectangles) {
    queue.copyExternalImageToTexture({source: image.source, origin: [x, y]},
      {texture, origin: [x, y], premultipliedAlpha: true, colorSpace: 'srgb'}, [width, height]);
  }
}
