/** A failed authoring operation never mutates the document. Codes are stable UI contracts. */
export class DesignerAuthoringError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DesignerAuthoringError';
    this.code = code;
    this.diagnostic = {code, message, severity: 'error', span: null, ...details};
  }
}

export function authoringError(code, message, details) {
  throw new DesignerAuthoringError(code, message, details);
}

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** Resource keys deliberately share the portable C# identifier subset. */
export function resourceKey(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z_]\w*$/.test(value) || unsafeKeys.has(value)) {
    authoringError('SFD1801', 'Use a resource identifier of at most 128 letters, digits or underscores.');
  }
  return value;
}

export function qualifiedIdentifier(value, label = 'Identifier') {
  if (typeof value !== 'string' || value.length > 256 || !/^([A-Za-z_]\w*\.)*[A-Za-z_]\w*$/.test(value)) {
    authoringError('SFD1802', `${label} must be a qualified C# identifier.`);
  }
  value.split('.').forEach(resourceKey);
  return value;
}

export function boundedArray(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit) {
    authoringError('SFD1803', `${label} must contain no more than ${limit} entries.`);
  }
  return value;
}

export function finiteNumber(value, {label = 'Value', minimum = -Infinity, maximum = Infinity, integer = false} = {}) {
  if (typeof value === 'string' && !value.trim()) authoringError('SFD1804', `${label} requires a number.`);
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || integer && !Number.isInteger(number) || number < minimum || number > maximum) {
    authoringError('SFD1804', `${label} must be ${integer ? 'an integer' : 'finite'} between ${minimum} and ${maximum}.`);
  }
  return number;
}

export const samePropertyValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
