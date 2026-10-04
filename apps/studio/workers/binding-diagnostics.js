import {assertUIHostData} from './ui-data.js';

const messages = Object.freeze({
  SFB001: 'Binding path syntax is invalid', SFB002: 'Binding source or path is unavailable',
  SFB003: 'Binding source member is unavailable', SFB004: 'Binding path index is unavailable',
  SFB005: 'Value converter failed', SFB006: 'Binding value could not be converted to the target type',
  SFB007: 'Binding source rejected the update', SFB008: 'Binding did not converge within the update budget',
  SFB009: 'Binding target is invalid', SFB010: 'Binding subscription could not be released'
});
const maximumBatch = 128;

/** Copy identities only. Exception text and arbitrary callback fields never enter Studio output. */
export function copyBindingDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(messages, value.code)
    || value.valuesRedacted !== true || value.severity !== 'warning') throw new TypeError('Invalid binding diagnostic');
  let truncated = false;
  const field = (name, maximum, nullable = false) => {
    const text = value[name];
    if (nullable && text === null) return null;
    if (typeof text !== 'string') throw new TypeError('Invalid binding diagnostic identity');
    truncated ||= text.length > maximum;
    return text.slice(0, maximum).replace(/[\u0000-\u001f\u007f]/g, ' ');
  };
  const path = field('path', 4096), sourceType = field('sourceType', 512, true), targetProperty = field('targetProperty', 256, true);
  const step = value.step;
  if (step !== null && (!Number.isSafeInteger(step) || step < 0 || step > 1048576)) throw new TypeError('Invalid binding path step');
  const message = /password|secret|token/i.test(path + targetProperty)
    ? 'Sensitive binding failed; values are redacted' : messages[value.code];
  return Object.freeze({code: value.code, severity: 'warning', path, step, sourceType, targetProperty, message,
    valuesRedacted: true, truncated: truncated || value.truncated === true});
}

/** A launch candidate buffers bounded diagnostics until it owns a committed worker session. */
export class RuntimeBindingDiagnostics {
  constructor({schedule = () => {}, maximum = maximumBatch} = {}) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maximumBatch) throw new RangeError('Invalid binding output limit');
    this.maximum = maximum;
    this.schedule = schedule;
    this.records = new Map();
    this.nextId = 1;
    this.omitted = 0;
    this.closed = false;
  }
  report(value) {
    if (this.closed) return false;
    try {
      const record = copyBindingDiagnostic(value), key = JSON.stringify(record);
      const existing = this.records.get(key);
      if (existing) existing.occurrences = Math.min(Number.MAX_SAFE_INTEGER, existing.occurrences + 1);
      else if (this.records.size >= this.maximum || this.nextId >= Number.MAX_SAFE_INTEGER) {
        this.omitted = Math.min(Number.MAX_SAFE_INTEGER, this.omitted + 1);
      } else this.records.set(key, {...record, diagnosticId: this.nextId++, occurrences: 1});
      this.schedule();
      return true;
    } catch { return false; }
  }
  flush(post, sessionId) {
    if (this.closed || !this.records.size && !this.omitted) return;
    const records = [...this.records.values()], omitted = this.omitted;
    this.records.clear(); this.omitted = 0;
    post({event: 'bindingDiagnostics', version: 1, sessionId, records, omitted});
  }
  dispose() { this.closed = true; this.records.clear(); this.omitted = 0; }
}

export function validateBindingDiagnosticBatch(value) {
  assertUIHostData(value);
  if (value?.event !== 'bindingDiagnostics' || value.version !== 1
    || !Number.isSafeInteger(value.sessionId) || value.sessionId < 1
    || !Array.isArray(value.records) || value.records.length > maximumBatch
    || !Number.isSafeInteger(value.omitted) || value.omitted < 0) throw new TypeError('Invalid binding diagnostic batch');
  const ids = new Set();
  const records = value.records.map(record => {
    if (!Number.isSafeInteger(record.diagnosticId) || record.diagnosticId < 1 || ids.has(record.diagnosticId)
      || !Number.isSafeInteger(record.occurrences) || record.occurrences < 1) throw new TypeError('Invalid binding diagnostic sequence');
    ids.add(record.diagnosticId);
    return Object.freeze({...copyBindingDiagnostic(record), diagnosticId: record.diagnosticId, occurrences: record.occurrences});
  });
  return Object.freeze({event: 'bindingDiagnostics', version: 1, sessionId: value.sessionId, records: Object.freeze(records), omitted: value.omitted});
}
