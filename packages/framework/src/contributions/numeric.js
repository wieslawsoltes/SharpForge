/** Numeric type identities use A05 without allocating framework member contracts. */
export function registerNumericTypes({en}) {
  en('System.MidpointRounding', Object.freeze({
    ToEven: 0,
    AwayFromZero: 1,
    ToZero: 2,
    ToNegativeInfinity: 3,
    ToPositiveInfinity: 4
  }));
}

export const numericTypeContribution = Object.freeze({name: 'A05', register: registerNumericTypes});
