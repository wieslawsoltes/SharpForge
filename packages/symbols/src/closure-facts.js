import { decodeCoded } from '@sharpforge/cil';
import { PdbGuids, fail } from './contracts.js';
import { metadataMemberOwners, metadataName } from './metadata-facts.js';

const key = (owner, ordinal) => `${owner}:${ordinal}`;
const displayClassName = /^<>c__DisplayClass([0-9]+)_([0-9]+)$/u;
const lambdaName = /^<([^<>]+)>b__([0-9]+)$/u;
const delegateCacheName = /^<>9__(?:[0-9]+_)?[0-9]+$/u;
export const unavailableClosure = (methodToken, reason) => ({
  available: false,
  reason,
  methodToken,
  containingMethod: null,
  captures: [],
});

function preflight(metadata, custom, limit) {
  let entries = custom.length;
  let hasMaps = false;
  for (const table of [2, 3, 4, 5, 6, 41, 42]) entries += metadata.counts[table] ?? 0;
  if (entries > limit) fail('Closure entry limit exceeded');
  for (const record of custom) {
    if (record.kind !== PdbGuids.encLambdas) continue;
    hasMaps = true;
    entries += record.closures.length + record.lambdas.length;
    if (entries > limit) fail('Closure entry limit exceeded');
  }
  return { entries, hasMaps };
}

function lambdaMaps(metadata, custom, owners) {
  const maps = new Map();
  for (const record of custom) {
    if (record.kind !== PdbGuids.encLambdas || record.methodOrdinal === -1) continue;
    const owner = owners.get(record.parent);
    if (!owner) fail('Closure lambda map has no declaring method');
    const identity = key(owner, record.methodOrdinal);
    if (maps.has(identity)) fail('Ambiguous closure method ordinal');
    maps.set(identity, {
      containingMethod: record.parent,
      methodOrdinal: record.methodOrdinal,
      name: metadataName(metadata, metadata.row(record.parent)[3], 'Closure metadata'),
      closures: record.closures.map(({ syntaxOffset }) => ({ syntaxOffset })),
      lambdas: record.lambdas.map(({ syntaxOffset, closureOrdinal }) => ({ syntaxOffset, closureOrdinal })),
    });
  }
  return maps;
}

function nestedTypes(metadata) {
  const types = new Map();
  for (const [nested, enclosing] of metadata.rows[41] ?? []) {
    if (
      !nested ||
      !enclosing ||
      nested > metadata.counts[2] ||
      enclosing > metadata.counts[2] ||
      nested === enclosing
    ) {
      fail('Invalid closure nested type');
    }
    const token = 0x02000000 | nested;
    if (types.has(token)) fail('Ambiguous closure nested type');
    types.set(token, 0x02000000 | enclosing);
  }
  return types;
}

function capturedFields(metadata, type) {
  const captures = [];
  const names = new Set();
  let supported = true;
  for (const fieldToken of metadata.list(type, 'FieldList')) {
    const row = metadata.row(fieldToken);
    const name = metadataName(metadata, row[1], 'Closure metadata');
    if (delegateCacheName.test(name)) continue;
    if (!name || name.startsWith('<') || name.startsWith('CS$<') || row[0] & 0x10) {
      supported = false;
      continue;
    }
    if (names.has(name)) fail('Ambiguous captured field name');
    names.add(name);
    captures.push({ name, fieldToken });
  }
  return { captures, supported };
}

function lambdaFact(methodToken, name, context) {
  const { map, closureType, closureOrdinal, fields } = context;
  const match = lambdaName.exec(name);
  if (!match) return unavailableClosure(methodToken, 'unsupported-lambda-convention');
  if (!map) return unavailableClosure(methodToken, 'missing-lambda-map');
  const lambdaOrdinal = Number(match[2]);
  const lambda = map.lambdas[lambdaOrdinal];
  const closure = map.closures[closureOrdinal];
  if (match[1] !== map.name || !lambda || !closure || lambda.closureOrdinal !== closureOrdinal) {
    return unavailableClosure(methodToken, 'inconsistent-lambda-map');
  }
  if (!fields.supported) return unavailableClosure(methodToken, 'unsupported-capture-field');
  return {
    available: true,
    reason: null,
    methodToken,
    containingMethod: map.containingMethod,
    methodOrdinal: map.methodOrdinal,
    lambdaOrdinal,
    syntaxOffset: lambda.syntaxOffset,
    closureType,
    closureOrdinal,
    closureSyntaxOffset: closure.syntaxOffset,
    captures: fields.captures,
  };
}

/** Snapshot only symbol facts; no PE bytes, metadata rows or decoded PDB arrays escape this call. */
export function snapshotClosureFacts(metadata, custom, limit) {
  if (!custom.some((record) => record.kind === PdbGuids.encLambdas)) return { facts: [], hasMaps: false };
  const budget = preflight(metadata, custom, limit);
  const owners = metadataMemberOwners(metadata, 6, 'MethodList', 'closure method');
  if (metadata.uncompressed && Object.hasOwn(metadata.counts, 3)) {
    metadataMemberOwners(metadata, 4, 'FieldList', 'closure field');
  }
  const maps = lambdaMaps(metadata, custom, owners);
  const genericOwners = new Set();
  for (const row of metadata.rows[42] ?? []) genericOwners.add(decodeCoded('TypeOrMethodDef', row[2]));
  const facts = [];
  for (const [type, parent] of nestedTypes(metadata)) {
    const name = metadataName(metadata, metadata.row(type)[1], 'Closure metadata');
    if (!name.startsWith('<>c__DisplayClass')) continue;
    const match = displayClassName.exec(name);
    const methodOrdinal = Number(match?.[1]);
    const closureOrdinal = Number(match?.[2]);
    const map = maps.get(key(parent, methodOrdinal));
    const supported =
      Number.isSafeInteger(methodOrdinal) &&
      Number.isSafeInteger(closureOrdinal) &&
      !genericOwners.has(type) &&
      !genericOwners.has(parent) &&
      !genericOwners.has(map?.containingMethod);
    const fields = supported && map ? capturedFields(metadata, type) : null;
    for (const methodToken of metadata.list(type, 'MethodList')) {
      const methodName = metadataName(metadata, metadata.row(methodToken)[3], 'Closure metadata');
      if (!methodName.includes('>b__')) continue;
      budget.entries += fields?.captures.length ?? 0;
      if (budget.entries > limit) fail('Closure entry limit exceeded');
      facts.push(
        supported
          ? lambdaFact(methodToken, methodName, { map, closureType: type, closureOrdinal, fields })
          : unavailableClosure(methodToken, 'unsupported-closure-convention'),
      );
    }
  }
  return { facts, hasMaps: budget.hasMaps };
}
