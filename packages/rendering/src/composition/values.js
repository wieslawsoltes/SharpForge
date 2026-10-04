export function finite(value, name = 'value', min = -1e12, max = 1e12) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`Invalid composition ${name}`);
  }
  return value;
}

export function vector(value, length, name = 'vector') {
  const components = Array.isArray(value) || ArrayBuffer.isView(value)
    ? Array.from(value) : ['X', 'Y', 'Z', 'W'].slice(0, length).map(component => value?.[component] ?? value?.[component.toLowerCase()]);
  if (components.length !== length) throw new TypeError(`Expected ${length}-component ${name}`);
  for (const component of components) finite(component, name);
  return Object.freeze(components);
}

export function color(value) {
  const components = Array.isArray(value) ? value : [value?.R, value?.G, value?.B, value?.A];
  if (components.length !== 4) throw new TypeError('Expected RGBA color');
  const normalized = Array.isArray(value) ? components : components.map(component => component / 255);
  for (const component of normalized) finite(component, 'color component', 0, 1);
  return Object.freeze([...normalized]);
}

export function identityMatrix() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

export function matrix(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    value = Array.from({length: 16}, (_, index) => value?.[`M${Math.floor(index / 4) + 1}${index % 4 + 1}`]);
  }
  if (value.length !== 16) throw new TypeError('Composition TransformMatrix requires 16 components');
  return Object.freeze(Array.from(value, component => finite(component, 'matrix component')));
}

export function multiplyMatrix(first, second) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let inner = 0; inner < 4; inner++) output[column * 4 + row] += first[inner * 4 + row] * second[column * 4 + inner];
    }
  }
  return output;
}

export function visualMatrix(values) {
  const [offsetX, offsetY, offsetZ] = values.Offset;
  const [width, height] = values.Size;
  const [centerX, centerY, centerZ] = values.CenterPoint;
  const [scaleX, scaleY, scaleZ] = values.Scale;
  const cosine = Math.cos(values.RotationAngle);
  const sine = Math.sin(values.RotationAngle);
  const anchorX = values.AnchorPoint[0] * width;
  const anchorY = values.AnchorPoint[1] * height;
  const transform = [cosine * scaleX, sine * scaleX, 0, 0, -sine * scaleY, cosine * scaleY, 0, 0,
    0, 0, scaleZ, 0, offsetX + centerX - anchorX, offsetY + centerY - anchorY, offsetZ + centerZ, 1];
  const origin = identityMatrix();
  origin[12] = -centerX;
  origin[13] = -centerY;
  origin[14] = -centerZ;
  return multiplyMatrix(multiplyMatrix(transform, values.TransformMatrix), origin);
}

export function matrix2D(value) {
  if (value[2] || value[3] || value[6] || value[7] || value[8] || value[9] || value[11] || value[15] !== 1) {
    throw new TypeError('SF_RENDER_3D_UNSUPPORTED: this backend requires an affine 2D composition transform');
  }
  return [value[0], value[1], value[4], value[5], value[12], value[13]];
}
