/** Captured byte pixels use premultiplied RGBA8 even when Canvas exposes straight color channels. */
export function canvasPixels(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.round(data[index + channel] * alpha);
  }
  return {width: canvas.width, height: canvas.height, data, alphaMode: 'premultiplied'};
}

export function pixelPacket(pixels) {
  let rgba = '';
  const bytes = pixels.data;
  for (let start = 0; start < bytes.length; start += 8192) rgba += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return {width: pixels.width, height: pixels.height, alphaMode: pixels.alphaMode, rgba: btoa(rgba)};
}
