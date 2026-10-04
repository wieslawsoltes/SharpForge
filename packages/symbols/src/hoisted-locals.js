import { PdbGuids, fail } from './contracts.js';
import { metadataMemberOwners, metadataName } from './metadata-facts.js';

function unavailable(reason, pair) {
  return { available: false, reason, moveNext: pair?.moveNext ?? null, kickoff: pair?.kickoff ?? null, locals: [] };
}

function snapshotScopes(pe, symbols, limit) {
  let entries = symbols.stateMachines.length * 2 + symbols.custom.length;
  for (const table of [2, 3, 4, 5, 6]) entries += pe.metadata.counts[table] ?? 0;
  if (entries > limit) fail('Hoisted local index entry limit exceeded');
  for (const record of symbols.custom) {
    if (record.kind !== PdbGuids.hoistedScopes) continue;
    if (!Array.isArray(record.scopes)) fail('Invalid hoisted local scopes');
    entries += record.scopes.length;
    if (entries > limit) fail('Hoisted local index entry limit exceeded');
  }
  const scopes = new Map();
  for (const record of symbols.custom) {
    if (record.kind !== PdbGuids.hoistedScopes) continue;
    if (scopes.has(record.parent)) fail('Duplicate hoisted local scope record');
    scopes.set(
      record.parent,
      record.scopes.map(({ start, end }) => ({ start, end })),
    );
  }
  return { scopes, entries };
}

function typeFields(metadata, owner) {
  const fields = [];
  let csharp = false;
  for (const fieldToken of metadata.list(owner, 'FieldList')) {
    const row = metadata.row(fieldToken);
    const name = metadataName(metadata, row[1], 'Hoisted field');
    if (name === '<>1__state') csharp = true;
    const match = /^<([^<>]+)>5__([1-9][0-9]*)$/u.exec(name);
    if (!match) continue;
    const slot = Number(match[2]) - 1;
    if (!Number.isSafeInteger(slot) || row[0] & 0x10) fail('Invalid hoisted user-local field');
    fields.push({ name: match[1], fieldToken, fieldName: name, slot });
  }
  return { csharp, fields };
}

function mapFields(pair) {
  const { scopes, fields, bodyLength } = pair;
  if (!scopes) return unavailable('missing-hoisted-scopes', pair);
  if (!fields.csharp) return unavailable('unsupported-field-convention', pair);
  for (const scope of scopes) {
    if (
      !Number.isInteger(scope.start) ||
      !Number.isInteger(scope.end) ||
      scope.start < 0 ||
      scope.end < scope.start ||
      scope.end > bodyLength ||
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

function snapshotFacts(pe, symbols, limit) {
  if (!symbols.bound || !symbols.stateMachines.length) return [];
  const budget = snapshotScopes(pe, symbols, limit);
  let owners;
  const fields = new Map();
  const facts = [];
  for (const pair of symbols.stateMachines) {
    const scopes = budget.scopes.get(pair.moveNext);
    const fact = { moveNext: pair.moveNext, kickoff: pair.kickoff, scopes, fields: null, bodyLength: 0 };
    if (!scopes) {
      facts.push(fact);
      continue;
    }
    owners ??= metadataMemberOwners(pe.metadata, 6, 'MethodList', 'hoisted local method');
    const owner = owners.get(pair.moveNext);
    if (!owner) fail('Hoisted local MoveNext has no declaring type');
    if (!fields.has(owner)) fields.set(owner, typeFields(pe.metadata, owner));
    const candidates = fields.get(owner);
    budget.entries += candidates.fields.length;
    if (budget.entries > limit) fail('Hoisted local index entry limit exceeded');
    fact.fields = candidates;
    if (candidates.csharp) {
      if (!pe.metadata.row(pair.moveNext)[0]) fail('Hoisted local MoveNext has no IL body');
      fact.bodyLength = pe.methodBody(pair.moveNext).code.length;
    }
    facts.push(fact);
  }
  return facts;
}

function lookupFromFacts(facts, bound) {
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
    if (!index) {
      index = buildIndex(facts);
      facts = null;
    }
    const mapped = index.get(methodToken);
    if (!mapped) return unavailable('not-state-machine');
    const locals = [];
    for (const local of mapped.locals) {
      if (offset >= local.startOffset && offset < local.endOffset) locals.push({ ...local });
    }
    return { ...mapped, locals };
  };
}

function buildIndex(facts) {
  const methods = new Map();
  for (const pair of facts) {
    if (methods.has(pair.moveNext) || methods.has(pair.kickoff)) fail('Ambiguous hoisted local method mapping');
    const mapped = mapFields(pair);
    methods.set(pair.moveNext, mapped);
    methods.set(pair.kickoff, mapped);
  }
  return methods;
}

/** Snapshot bounded relevant facts at load; lazily index them without retaining borrowed bytes or ASTs. */
export function createHoistedLocalLookup(pe, symbols, { maxHoistedEntries = 100_000 } = {}) {
  if (!Number.isInteger(maxHoistedEntries) || maxHoistedEntries < 0 || maxHoistedEntries > 1_000_000) {
    fail('Invalid hoisted local index limit');
  }
  return lookupFromFacts(snapshotFacts(pe, symbols, maxHoistedEntries), symbols.bound);
}
