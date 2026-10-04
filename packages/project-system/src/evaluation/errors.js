/** A located, stable MSBuild-style evaluation failure. */
export class EvaluationError extends Error {
  constructor(message, code = 'MSB4184', location = {}) {
    super(message);
    this.name = 'EvaluationError';
    this.code = code;
    Object.assign(this, location);
  }
}

export function fail(message, code, location) {
  throw new EvaluationError(message, code, location);
}

export const lower = value => String(value).toLowerCase();
export const unescape = value => String(value).replace(/%([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
export const escape = value => String(value).replace(/[%$@();?'*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
export const splitList = value => String(value ?? '').split(';').map(part => unescape(part.trim())).filter(Boolean);

/** Read an own property or metadata key, preferring exact spelling; missing keys return undefined. */
export function getCaseInsensitive(object, name) {
  if (!object) return undefined;
  if (Object.hasOwn(object, name)) return object[name];
  const key = Object.keys(object).find(key => lower(key) === lower(name));
  return key === undefined ? undefined : object[key];
}

export function setCaseInsensitive(object, name, value) {
  const key = Object.keys(object).find(key => lower(key) === lower(name));
  object[key ?? name] = value;
}

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (/^(true|on|yes)$/i.test(String(value))) return true;
  if (/^(false|off|no)$/i.test(String(value))) return false;
  return fail(`'${value}' is not a Boolean value.`, 'MSB4130');
}

export function number(value, integer = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) {
    fail(`'${value}' is not a ${integer ? 'safe integer' : 'finite number'}.`);
  }
  return result;
}

export function formatValue(value) {
  if (Array.isArray(value)) return value.map(formatValue).join(';');
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value.value !== undefined) return String(value.value);
  return String(value);
}
