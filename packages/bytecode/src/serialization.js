import {FORMAT_VERSION} from './opcodes.js';

/** Serialize an image with typed instruction storage preserved by an explicit JSON tag. */
export function serializeImage(image) {
  return JSON.stringify(image, (key, value) => value instanceof Int32Array ? {$int32: [...value]} : value);
}

/** Restore an image's typed instruction storage; reject incompatible bytecode versions. */
export function deserializeImage(text) {
  const image = JSON.parse(text, (key, value) => value?.$int32 ? Int32Array.from(value.$int32) : value);
  if (image.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported SharpForge bytecode version');
  return image;
}
