import {referenceCanvas, canvasReferencePacket} from './canvas-primitives.js';

export async function svgReference(document, definition, body, details = {}) {
  const {canvas, painter} = referenceCanvas(document, definition);
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${definition.width}" height="${definition.height}" ` +
    `viewBox="0 0 ${definition.width} ${definition.height}" color-interpolation="sRGB">${body}</svg>`;
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sourceSha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const url = URL.createObjectURL(new Blob([source], {type: 'image/svg+xml'}));
  const image = document.createElement('img');
  try {
    image.src = url;
    await image.decode();
    painter.drawImage(image, 0, 0, definition.width, definition.height);
    return canvasReferencePacket(canvas, {kind: 'svg-declared-scene', provider: 'browser-native-svg',
      sourceSha256, sourceBytes: bytes.length, ...details});
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

/** SVG filters are implemented by the browser, independently of SharpForge's CPU/GPU effect graph. */
export function effectReference(document, definition) {
  const type = definition.effectType ?? 'GaussianBlur';
  const color = '<feFlood flood-color="rgb(25.5,204,76.5)" flood-opacity="0.8" result="color"/>';
  const filters = {
    GaussianBlur: '<feGaussianBlur in="SourceGraphic" stdDeviation="4"/>',
    Saturation: '<feColorMatrix in="SourceGraphic" type="saturate" values="0"/>',
    Opacity: '<feComponentTransfer in="SourceGraphic"><feFuncA type="linear" slope="0.4"/></feComponentTransfer>',
    Tint: '<feColorMatrix in="SourceGraphic" type="matrix" values="0.4 0 0 0 0 0 0.8 0 0 0 0 0 1 0 0 0 0 0 1 0"/>',
    ColorSource: color,
    Blend: color + '<feBlend in="SourceGraphic" in2="color" mode="multiply"/>',
    ArithmeticComposite: color + '<feComposite in="SourceGraphic" in2="color" operator="arithmetic" k1="0" k2="0.5" k3="0.5" k4="0"/>'
  };
  if (!filters[type]) throw new TypeError('Unknown independently declared SVG effect: ' + type);
  const filter = `<defs><filter id="reference-effect" x="0" y="0" width="${definition.width}" height="${definition.height}" ` +
    'filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' + filters[type] + '</filter></defs>';
  return svgReference(document, definition, filter +
    '<g filter="url(#reference-effect)"><rect x="24" y="24" width="64" height="32" fill="#c040ff"/></g>');
}
