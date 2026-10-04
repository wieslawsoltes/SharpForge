import { MethodDisplayTypes } from './method-display.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** ParameterInfo display uses the type's '&' suffix and omits a missing metadata name. */
export function formatParameterDisplay(parameter) {
  try {
    const type = new MethodDisplayTypes(parameter.method).display(parameter.signatureType);
    const name = parameter.name;
    if (type.length + (name === null ? 0 : name.length + 1) > 16384) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Parameter display limit exceeded');
    }
    return name === null ? type : `${type} ${name}`;
  } catch (error) {
    if (error.code?.startsWith('SFCLR')) throw error;
    throw loadError(LoadErrorCode.InvalidImage, `Invalid parameter display: ${error.message}`);
  }
}
