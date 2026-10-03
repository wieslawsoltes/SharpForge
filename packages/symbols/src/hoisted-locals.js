import { PdbGuids, fail } from './contracts.js';

function unavailable(reason, pair) {
  return { available: false, reason, moveNext: pair?.moveNext ?? null, kickoff: pair?.kickoff ?? null, locals: [] };
}

function scopeIndex(pe, symbols, limit) {
  let entries = symbols.stateMachines.length * 2 + symbols.custom.length;
  for (const table of [2, 4, 6]) entries += pe.metadata.counts[table] ?? 0;
  if (entries > limit) fail('Hoisted local index entry limit exceeded');
  const scopes = new Map();
  for (const record of symbols.custom) {
    if (record.kind !== PdbGuids.hoistedScopes) continue;
    if (!Array.isArray(record.scopes)) fail('Invalid hoisted local scopes');
    entries += record.scopes.length;
    if (entries > limit) fail('Hoisted local index entry limit exceeded');
    if (scopes.has(record.parent)) fail('Duplicate hoisted local scope record');
    scopes.set(record.parent, record.scopes);
  }
  return { scopes, entries };
}

function methodOwners(metadata) {
  const owners = new Map();
  for (let row = 1; row <= (metadata.counts[2] ?? 0); row++) {
    const type = 0x02000000 | row;
    for (const method of metadata.list(type, 'MethodList')) owners.set(method, type);
  }
  return owners;
}

function typeFields(metadata, owner) {
  const fields = [];
  let csharp = false;
  for (const fieldToken of metadata.list(owner, 'FieldList')) {
    const row = metadata.row(fieldToken);
    const fieldName = metadata.string(row[1]);
    if (fieldName.length > 1024) fail('Hoisted field name exceeds length limit');
    if (fieldName === '<>1__state') csharp = true;
    const match = /^<([^<>]+)>5__([1-9][0-9]*)$/u.exec(fieldName);
    if (!match) continue;
    const slot = Number(match[2]) - 1;
    if (!Number.isSafeInteger(slot) || row[0] & 0x10) fail('Invalid hoisted user-local field');
    fields.push({ name: match[1], fieldToken, fieldName, slot });
  }
  return { csharp, fields };
}

function mapFields(pe, pair, scopes, fields) {
  if (!scopes) return unavailable('missing-hoisted-scopes', pair);
  if (!fields.csharp) return unavailable('unsupported-field-convention', pair);
  if (!pe.metadata.row(pair.moveNext)[0]) fail('Hoisted local MoveNext has no IL body');
  const length = pe.methodBody(pair.moveNext).code.length;
  for (const scope of scopes) {
    if (
      !Number.isInteger(scope.start) ||
      !Number.isInteger(scope.end) ||
      scope.start < 0 ||
      scope.end < scope.start ||
      scope.end > length ||
      (scope.start === scope.end && scope.start !== 0)
    ) {
      fail('Invalid hoisted local scope range');
    }
  }
  const slots = new Set();
  const locals = [];
  for (const field of fields.fields) {
    if (slots.has(field.slot)) fail('Ambiguous hoisted local field slot');
    slots.add(field.slot);
    const scope = scopes[field.slot];
    if (!scope || scope.end === 0) return unavailable('missing-user-local-scope', pair);
    locals.push({ ...field, startOffset: scope.start, endOffset: scope.end });
  }
  if (scopes.some((scope, slot) => scope.end > 0 && !slots.has(slot))) {
    return unavailable('unsupported-hoisted-local-slot', pair);
  }
  return { available: true, reason: null, moveNext: pair.moveNext, kickoff: pair.kickoff, locals };
}

function buildIndex(pe, symbols, limit) {
  if (!symbols.stateMachines.length) return new Map();
  const budget = scopeIndex(pe, symbols, limit);
  let owners;
  const fields = new Map();
  const methods = new Map();
  for (const pair of symbols.stateMachines) {
    if (methods.has(pair.moveNext) || methods.has(pair.kickoff)) fail('Ambiguous hoisted local method mapping');
    const scopes = budget.scopes.get(pair.moveNext);
    if (!scopes) {
      const missing = unavailable('missing-hoisted-scopes', pair);
      methods.set(pair.moveNext, missing);
      methods.set(pair.kickoff, missing);
      continue;
    }
    owners ??= methodOwners(pe.metadata);
    const owner = owners.get(pair.moveNext);
    if (!owner) fail('Hoisted local MoveNext has no declaring type');
    if (!fields.has(owner)) fields.set(owner, typeFields(pe.metadata, owner));
    const candidates = fields.get(owner);
    budget.entries += candidates.fields.length;
    if (budget.entries > limit) fail('Hoisted local index entry limit exceeded');
    const mapped = mapFields(pe, pair, scopes, candidates);
    methods.set(pair.moveNext, mapped);
    methods.set(pair.kickoff, mapped);
  }
  return methods;
}

/** Lazy per-loaded-assembly index; missing metadata never becomes a guessed user local. */
export function createHoistedLocalLookup(pe, symbols, { maxHoistedEntries = 100_000 } = {}) {
  if (!Number.isInteger(maxHoistedEntries) || maxHoistedEntries < 0 || maxHoistedEntries > 1_000_000) {
    fail('Invalid hoisted local index limit');
  }
  const bound = symbols.bound;
  let index;
  return (methodToken, offset) => {
    if (
      !Number.isInteger(methodToken) ||
      methodToken < 0x06000001 ||
      methodToken > 0x06ffffff ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 0x7fffffff
    )
      fail('Invalid hoisted local query');
    if (!bound) return unavailable('unbound-symbols');
    index ??= buildIndex(pe, symbols, maxHoistedEntries);
    const mapped = index.get(methodToken);
    if (!mapped) return unavailable('not-state-machine');
    const locals = [];
    for (const local of mapped.locals) {
      if (offset >= local.startOffset && offset < local.endOffset) locals.push({ ...local });
    }
    return { ...mapped, locals };
  };
}
