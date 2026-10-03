/** A05 contributes no legacy member IDs; new enum ordinals append after released enums. */
export function registerRuntimeNumerics({en}) {
  en('System.MidpointRounding', {
    ToEven: 0, AwayFromZero: 1, ToZero: 2, ToNegativeInfinity: 3, ToPositiveInfinity: 4
  });
}
