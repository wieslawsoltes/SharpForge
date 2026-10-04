import { ControlEvents, ControlError } from '../policy/events.js';

/** Image sources retain URI/decode intent; decoding belongs to the host and can be cancelled. */
export class BitmapImage extends ControlEvents {
  constructor(uri = '', { decodePixelWidth = 0, decodePixelHeight = 0 } = {}) {
    super();
    this.UriSource = uri;
    this.DecodePixelWidth = decodePixelWidth;
    this.DecodePixelHeight = decodePixelHeight;
    this.PixelWidth = 0;
    this.PixelHeight = 0;
  }
  snapshot() { return { version: 1, UriSource: this.UriSource, DecodePixelWidth: this.DecodePixelWidth,
    DecodePixelHeight: this.DecodePixelHeight, PixelWidth: this.PixelWidth, PixelHeight: this.PixelHeight }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI16B0', 'Invalid image source snapshot');
    for (const key of ['UriSource', 'DecodePixelWidth', 'DecodePixelHeight', 'PixelWidth', 'PixelHeight']) this[key] = snapshot[key];
  }
}

export { WriteableBitmap } from '@sharpforge/rendering';

/** Nine-grid source/destination rectangles use physical pixels and clamp opposing slices. */
export function drawNineGrid(context, image, width, height, margins) {
  const sourceWidth = image.naturalWidth ?? image.width;
  const sourceHeight = image.naturalHeight ?? image.height;
  const left = Math.max(0, Math.min(sourceWidth, margins.Left ?? 0));
  const right = Math.max(0, Math.min(sourceWidth - left, margins.Right ?? 0));
  const top = Math.max(0, Math.min(sourceHeight, margins.Top ?? 0));
  const bottom = Math.max(0, Math.min(sourceHeight - top, margins.Bottom ?? 0));
  const scaleX = Math.min(1, width / Math.max(1, left + right));
  const scaleY = Math.min(1, height / Math.max(1, top + bottom));
  const sx = [0, left, sourceWidth - right, sourceWidth];
  const sy = [0, top, sourceHeight - bottom, sourceHeight];
  const dx = [0, left * scaleX, width - right * scaleX, width];
  const dy = [0, top * scaleY, height - bottom * scaleY, height];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    if (sx[column + 1] <= sx[column] || sy[row + 1] <= sy[row]) continue;
    context.drawImage(image, sx[column], sy[row], sx[column + 1] - sx[column], sy[row + 1] - sy[row],
      dx[column], dy[row], dx[column + 1] - dx[column], dy[row + 1] - dy[row]);
  }
}
