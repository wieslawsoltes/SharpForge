import {verifyImage} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

export {constantType, defaultValue} from './analysis-types.js';

/** Reject invalid compiler images and methods exceeding the CIL local limit. */
export function validateInput(image) {
  const errors = verifyImage(image);
  if (errors.length) {
    throw new CilError('Invalid compiler image: ' + errors.join('; '));
  }
  for (const method of image.methods) {
    if (method.locals.length > 65000) {
      throw new CilError('Too many locals for CIL emission');
    }
  }
}
