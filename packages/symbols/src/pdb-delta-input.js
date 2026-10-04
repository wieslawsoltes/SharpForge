import { utf8 } from '@sharpforge/cil';
import { HIDDEN } from './contracts.js';
import { generationError } from './pdb-delta-format.js';

const maximumBytes = 64 * 1024 * 1024;

function inputError(message) { generationError('PDB_DELTA_INPUT', message); }

class InputBudget {
  constructor(options) {
    this.signal = options.signal;
    this.limits = { maxBytes: maximumBytes, maxRecords: 100_000, maxPoints: 1_000_000, maxSourceBytes: 16 * 1024 * 1024 };
    for (const [key, maximum] of Object.entries(this.limits)) {
      const value = options[key] ?? maximum;
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) inputError(`Invalid PDB delta ${key}`);
      this.limits[key] = value;
    }
    this.records = 0;
    this.bytes = 0;
    this.points = 0;
    this.check();
  }
  check() {
    if (this.signal?.aborted) generationError('PDB_DELTA_CANCELLED', 'PDB delta writing cancelled');
  }
  charge(name, value, maximum) {
    this[name] += value;
    if (this[name] > maximum) generationError('PDB_DELTA_BUDGET', `PDB delta ${name} budget exceeded`);
  }
  array(value, label) {
    value ??= [];
    if (!Array.isArray(value)) inputError(`PDB delta ${label} must be an array`);
    this.charge('records', value.length, this.limits.maxRecords);
    return value;
  }
  string(value, maximum, label, allowNull = false) {
    if (typeof value !== 'string' || value.length > maximum || (!allowNull && value.includes('\0'))) inputError(`Invalid PDB delta ${label}`);
    this.charge('bytes', value.length * 3, this.limits.maxBytes);
  }
  payload(value, label) {
    if (!(value instanceof Uint8Array)) inputError(`Invalid PDB delta ${label} bytes`);
    this.charge('bytes', value.length, this.limits.maxBytes);
  }
}

function point(value, codeSize, documents) {
  if (!value || !Number.isInteger(value.offset) || value.offset < 0 || value.offset >= codeSize ||
      !Number.isInteger(value.document) || value.document < 1 || value.document > documents) {
    inputError('PDB delta sequence point is outside its method or documents');
  }
  const result = { ...value };
  if (value.hidden !== undefined && typeof value.hidden !== 'boolean') inputError('Invalid PDB delta hidden point');
  if (value.hidden || value.startLine === HIDDEN) {
    return { offset: value.offset, document: value.document, startLine: HIDDEN, endLine: HIDDEN,
      startColumn: 0, endColumn: 0, hidden: true };
  }
  for (const name of ['startLine', 'endLine', 'startColumn', 'endColumn']) {
    const maximum = name.endsWith('Line') ? 0x1fffffff : 65535;
    if (!Number.isInteger(value[name]) || value[name] < 0 || value[name] > maximum) inputError('Invalid PDB delta sequence span');
  }
  result.hidden = false;
  return result;
}

function sourcesFor(debug, budget) {
  const names = new Set();
  return budget.array(debug.sources, 'sources').map((source) => {
    budget.string(source?.uri, 32768, 'document name');
    if (names.has(source.uri)) inputError('Duplicate PDB delta document name');
    names.add(source.uri);
    if (source.text !== undefined && (typeof source.text !== 'string' || source.text.length > budget.limits.maxSourceBytes)) {
      inputError('Invalid or oversized PDB delta source text');
    }
    const bytes = source.bytes ?? utf8(source.text ?? '');
    budget.payload(bytes, 'source');
    if (bytes.length > budget.limits.maxSourceBytes) generationError('PDB_DELTA_BUDGET', 'PDB delta source budget exceeded');
    return { ...source, bytes: new Uint8Array(bytes) };
  });
}

function scopesFor(method, budget) {
  const scopes = budget.array(method.scopes, 'scopes');
  if (!method.codeSize && scopes.length) inputError('PDB delta scopes require a nonempty method body');
  for (const scope of scopes) {
    if (!scope || typeof scope !== 'object') inputError('Invalid PDB delta scope');
    for (const local of budget.array(scope.locals, 'locals')) budget.string(local?.name, 1024, 'local name');
    for (const constant of budget.array(scope.constants, 'constants')) {
      budget.string(constant?.name, 1024, 'constant name');
      if (constant.signature !== undefined) budget.payload(constant.signature, 'constant signature');
      if (typeof constant.value === 'string') budget.string(constant.value, 1024 * 1024, 'constant value', true);
    }
  }
  return scopes;
}

/** Bound caller facts before sorting, encoding, hashing or allocating metadata rows. */
export function preparePdbDeltaInput(debug, counts, options) {
  if (!debug || typeof debug !== 'object') inputError('Invalid PDB delta debug records');
  const budget = new InputBudget(options);
  if ((counts[6] ?? 0) > 100_000) generationError('PDB_DELTA_BUDGET', 'PDB delta aggregate method budget exceeded');
  const sources = sourcesFor(debug, budget);
  const seen = new Set();
  const methods = budget.array(debug.methods, 'methods').map((method) => {
    budget.check();
    if (!method || !Number.isInteger(method.token) || method.token < 0x06000001 ||
        method.token > 0x06000000 + (counts[6] ?? 0) || seen.has(method.token)) inputError('Invalid or duplicate PDB delta method');
    seen.add(method.token);
    const localSignature = method.localSignature ?? 0;
    if (!Number.isInteger(localSignature) || localSignature < 0 || localSignature > (counts[17] ?? 0)) inputError('Invalid PDB delta local signature');
    if (!Number.isInteger(method.codeSize) || method.codeSize < 0 || method.codeSize >= 0x20000000) inputError('Invalid PDB delta code size');
    const points = method.points ?? [];
    if (!Array.isArray(points)) inputError('PDB delta sequence points must be an array');
    budget.charge('points', points.length, budget.limits.maxPoints);
    if (!points.length && localSignature) inputError('An empty PDB sequence-point blob cannot retain a local signature');
    return { ...method, localSignature, points: points.map((value) => point(value, method.codeSize, sources.length)),
      scopes: scopesFor(method, budget) };
  }).sort((left, right) => left.token - right.token);
  if (!methods.length) inputError('PDB delta requires at least one changed method');
  budget.charge('records', methods.length, budget.limits.maxRecords);
  const imports = budget.array(debug.importScopes, 'imports');
  for (const scope of imports) {
    if (!scope || typeof scope !== 'object') inputError('Invalid PDB delta import scope');
    for (const definition of budget.array(scope.definitions, 'import definitions')) {
      if (!definition || typeof definition !== 'object') inputError('Invalid PDB delta import definition');
      for (const name of ['alias', 'namespace']) if (definition[name] !== undefined) budget.string(definition[name], 4096, 'import name');
    }
  }
  const custom = budget.array(debug.custom, 'custom debug records');
  for (const record of custom) {
    if (!record || typeof record.kind !== 'string') inputError('Invalid PDB delta custom debug record');
    budget.payload(record.bytes, 'custom debug');
  }
  const stateMachines = budget.array(debug.stateMachines, 'state machines');
  return { methods, sources, imports, custom, stateMachines, budget };
}
