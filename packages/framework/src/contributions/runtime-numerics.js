import {registerRuntimeExceptions} from './runtime-exceptions.js';
/** A05 additions use its reserved member block; enum ordinals append after released enums. */
export function registerRuntimeNumerics(api) {
  const {en}=api;
  en('System.MidpointRounding', {
    ToEven: 0, AwayFromZero: 1, ToZero: 2, ToNegativeInfinity: 3, ToPositiveInfinity: 4
  });
  registerRuntimeExceptions(api);
}
