import { invalidUsage, usageCancelled, usageLimit, usageToken } from './analyzers-input.js';

export const declarationRelations = Object.freeze(['overridden-by', 'implemented-by']);
const implementationKinds = new Set(['override', 'explicit', 'implicit', 'inherited']);

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidUsage(name);
}

function relation(value) {
  if (!declarationRelations.includes(value)) invalidUsage('declaration relation');
  return value;
}

/** Validate and copy a host's canonical relation snapshot; no method-slot inference occurs in the CIL layer. */
export function snapshotDeclarationRelations(input, context) {
  const { counts, prefix, limits, signal } = context;
  object(input, 'method relation snapshot');
  if (input.format !== 'sharpforge.method-relations' || input.version !== 1) invalidUsage('method relation snapshot version');
  if (`sf-metadata://${input.moduleVersionId}/` !== prefix || input.methodCount !== counts[6] || input.typeCount !== counts[2]) {
    invalidUsage('method relation snapshot belongs to a different module');
  }
  if (!Array.isArray(input.entries) || !Array.isArray(input.diagnostics)) invalidUsage('method relation snapshot arrays');
  const entryCount = input.entries.length;
  const diagnosticCount = input.diagnostics.length;
  if (entryCount > limits.maxDeclarationRelations) usageLimit('declaration relations');
  if (diagnosticCount > limits.maxDeclarationDiagnostics) usageLimit('declaration diagnostics');
  const entries = [];
  const diagnostics = [];
  const identities = new Set();
  for (let position = 0; position < entryCount; position++) {
    usageCancelled(signal);
    const entry = input.entries[position];
    object(entry, 'method relation entry');
    const kind = relation(entry.relation);
    const sourceToken = usageToken(counts, entry.sourceToken, [6]);
    const targetToken = usageToken(counts, entry.targetToken, [6]);
    if (kind === 'overridden-by' && sourceToken === targetToken) invalidUsage('self-overridden method relation');
    const implementingTypeToken = usageToken(counts, entry.implementingTypeToken, [2]);
    if (!implementationKinds.has(entry.implementationKind) ||
        (kind === 'overridden-by') !== (entry.implementationKind === 'override')) invalidUsage('method relation implementation kind');
    const identity = `${kind}:${sourceToken}:${targetToken}:${implementingTypeToken}`;
    if (identities.has(identity)) invalidUsage('duplicate method relation');
    identities.add(identity);
    entries.push({ relation: kind, sourceToken, targetToken, implementingTypeToken,
      implementationKind: entry.implementationKind, status: 'known', reason: null });
  }
  for (let position = 0; position < diagnosticCount; position++) {
    usageCancelled(signal);
    const diagnostic = input.diagnostics[position];
    object(diagnostic, 'method relation diagnostic');
    const kind = relation(diagnostic.relation);
    const token = usageToken(counts, diagnostic.token, [2, 6]);
    if (typeof diagnostic.code !== 'string' || !/^[A-Z][A-Z0-9]{2,31}$/.test(diagnostic.code) ||
        typeof diagnostic.reason !== 'string' || !diagnostic.reason.length || diagnostic.reason.length > 1024) {
      invalidUsage('method relation diagnostic detail');
    }
    diagnostics.push({ relation: kind, token, code: diagnostic.code, reason: diagnostic.reason });
  }
  return { entries, diagnostics };
}
