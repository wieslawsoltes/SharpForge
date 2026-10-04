import {imagePixels} from './canvas-primitives.js';
import {svgReference} from './svg-effects.js';

function gradientDefinitions() {
  return '<linearGradient id="linear" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="rgb(255,51,25.5)"/><stop offset="1" stop-color="rgb(25.5,102,255)"/></linearGradient>' +
    '<radialGradient id="radial"><stop offset="0" stop-color="rgb(255,51,25.5)"/>' +
    '<stop offset="1" stop-color="rgb(25.5,102,255)" stop-opacity="0"/></radialGradient>';
}

function nineGrid(image) {
  const source = [0, 0.5, 1.5, 2];
  const destination = [0, 0.5, 31.5, 32];
  const patches = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const width = destination[column + 1] - destination[column];
      const height = destination[row + 1] - destination[row];
      const view = [source[column], source[row], source[column + 1] - source[column], source[row + 1] - source[row]];
      patches.push(`<svg x="${destination[column]}" y="${destination[row]}" width="${width}" height="${height}" ` +
        `viewBox="${view.join(' ')}" preserveAspectRatio="none"><image href="${image}" width="2" height="2"/></svg>`);
    }
  }
  return patches.join('');
}

function brushReference(document, definition) {
  const source = imagePixels(document);
  const image = source.toDataURL('image/png');
  source.width = source.height = 0;
  const defs = '<defs>' + gradientDefinitions() +
    '<mask id="alpha-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32" style="mask-type:alpha">' +
    '<rect width="32" height="32" fill="url(#radial)"/></mask>' +
    '<filter id="saturation" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.2"/></filter></defs>';
  const brushes = [
    '<rect width="32" height="32" fill="rgb(51,127.5,229.5)"/>',
    '<rect width="32" height="32" fill="url(#linear)"/>',
    '<rect width="32" height="32" fill="url(#radial)"/>',
    `<image href="${image}" width="32" height="32" preserveAspectRatio="none"/>`,
    nineGrid(image),
    '<rect width="32" height="32" fill="url(#linear)" mask="url(#alpha-mask)"/>',
    '<rect width="32" height="32" fill="#ffe8c0"/>',
    '<rect width="32" height="32" fill="url(#linear)" filter="url(#saturation)"/>'
  ];
  const body = defs + `<rect width="${definition.width}" height="${definition.height}" fill="#ffe8c0"/>` +
    `<rect y="45" width="${definition.width}" height="20" fill="#30b060"/>` +
    brushes.map((brush, index) => `<g transform="translate(${4 + index % 3 * 42} ${4 + Math.floor(index / 3) * 42})">` +
      brush + '</g>').join('');
  return svgReference(document, definition, body, {referenceOperations: ['gradient', 'radial', 'image', 'nine-grid', 'alpha-mask', 'backdrop', 'saturation']});
}

function trimReference(document, definition) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M24 12H100A12 12 0 0 1 112 24V68A12 12 0 0 1 100 80H24A12 12 0 0 1 12 68V24A12 12 0 0 1 24 12Z');
  svg.append(path);
  Object.assign(svg.style, {position: 'fixed', left: '-10000px', visibility: 'hidden'});
  document.body.append(svg);
  try {
    const length = path.getTotalLength();
    const begin = length * 0.15;
    const end = length * 0.85;
    const samples = Math.ceil((end - begin) * 32);
    if (!Number.isFinite(length) || samples > 50000) throw new RangeError('Native trim reference sample budget exceeded');
    const points = [];
    for (let index = 0; index <= samples; index++) {
      const point = path.getPointAtLength(begin + (end - begin) * index / samples);
      points.push(`${index ? 'L' : 'M'}${point.x} ${point.y}`);
    }
    const gradient = '<defs><linearGradient id="trim-gradient" gradientUnits="userSpaceOnUse" x1="12" y1="12" x2="112" y2="80">' +
      '<stop offset="0" stop-color="rgb(255,51,25.5)"/><stop offset="1" stop-color="rgb(25.5,102,255)"/></linearGradient></defs>';
    return svgReference(document, definition, gradient +
      `<path d="${points.join('')}" fill="none" stroke="url(#trim-gradient)" stroke-width="5" ` +
      'stroke-dasharray="0 10 10 5" stroke-linecap="round"/>',
    {nativePathLength: length, nativeTrimSamples: samples, maximumSampleSpacingDip: 1 / 32});
  } finally {
    svg.remove();
  }
}

/** References come from browser SVG image/filter/path APIs, never compositor output descriptors. */
export function compositionReference(document, definition) {
  return definition.scene === 'composition-trim' ? trimReference(document, definition) : brushReference(document, definition);
}
