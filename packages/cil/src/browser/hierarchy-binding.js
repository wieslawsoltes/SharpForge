import { AssemblyInspector } from '../inspector.js';
import { metadataTokenUri } from './navigation.js';
import { localDefinitionNames } from '../verify/metadata-types/definition-names.js';
import { snapshotMetadataNesting } from '../verify/metadata-nesting.js';
import { hierarchyCoded, hierarchyToken, invalidHierarchy, hierarchyLimit } from './hierarchy-budget.js';
import { hierarchyAssemblyIdentity } from './hierarchy-identities.js';

function moduleSnapshot(inspector, index, module, budget) {
  if (!(inspector instanceof AssemblyInspector)) invalidHierarchy('loaded AssemblyInspector');
  const metadata = inspector.metadata, rows = metadata.rows[2] ?? [];
  if (metadata.rows[0]?.length !== 1 || (metadata.rows[32]?.length ?? 0) > 1) invalidHierarchy('module/assembly rows');
  const prefix = metadataTokenUri(metadata, 1).slice(0, -10);
  const definitions = new Map(), visibility = new Uint8Array(rows.length);
  for (let rid = 1; rid <= rows.length; rid++) {
    budget.check();
    const token = 0x02000000 + rid, id = prefix + '0x' + token.toString(16).padStart(8, '0');
    if (index.get(id)?.kind !== 'type') invalidHierarchy('index does not contain loaded type');
    const flags = rows[rid - 1][0];
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) invalidHierarchy('type flags');
    visibility[rid - 1] = flags & 7;
    definitions.set(token, { type: { token }, id, module, isInterface: !!(flags & 0x20), base: null, interfaces: [] });
  }
  snapshotMetadataNesting(metadata.rows[41] ?? [], visibility,
    { check: () => budget.check(), invalid: invalidHierarchy, limit: hierarchyLimit });
  const names = localDefinitionNames(metadata, definitions, { ...budget, maxTypeNameBytes: budget.maxNameBytes }, true);
  const definition = metadata.rows[32]?.[0];
  return { metadata, definitions, names, prefix, references: new Map(), referenceDepths: new Map(), resolving: new Set(), assemblies: new Map(),
    identity: definition ? hierarchyAssemblyIdentity(metadata, definition) : null };
}

function bindAssemblies(modules, budget) {
  const identities = new Map();
  for (const module of modules) {
    if (!module.identity) continue;
    const key = module.identity.key;
    identities.set(key, identities.has(key) ? null : module);
  }
  for (const module of modules) {
    const rows = module.metadata.rows[35] ?? [];
    for (let rid = 1; rid <= rows.length; rid++) {
      budget.check();
      const identity = hierarchyAssemblyIdentity(module.metadata, rows[rid - 1], true);
      const target = identities.get(identity.key);
      const reason = identity.retargetable ? 'retargetable-reference' : target === null ? 'ambiguous-assembly'
        : target === undefined ? 'missing-assembly' : null;
      module.assemblies.set(0x23000000 + rid, reason ? { reason } : { module: target });
    }
  }
}

function deadReference(module, token, reason) {
  const row = module.metadata.row(token);
  const namespace = token >>> 24 === 1 ? module.metadata.string(row[2]) : '';
  const name = token >>> 24 === 1 ? module.metadata.string(row[1]) : 'TypeSpec';
  return { referenceId: module.prefix + '0x' + token.toString(16).padStart(8, '0'),
    name: namespace ? namespace + '.' + name : name, reason };
}

function namedTarget(source, target, owner, row) {
  const token = target.names.lookupKeys(owner, source.names.key(row[2]), source.names.key(row[1]));
  return token === null ? { reason: 'ambiguous-type' } : token ? target.definitions.get(token) : { reason: 'unresolved-type' };
}

function referenceTarget(module, token, modules, budget, depth) {
  const maximum = Math.min(64, budget.maxDepth);
  if (module.references.has(token)) {
    if (depth + module.referenceDepths.get(token) > maximum) hierarchyLimit('TypeRef scope depth');
    return module.references.get(token);
  }
  if (module.resolving.has(token)) invalidHierarchy('cyclic TypeRef scopes');
  if (depth >= maximum) hierarchyLimit('TypeRef scope depth');
  budget.check();
  module.resolving.add(token);
  const row = module.metadata.row(token);
  const scope = hierarchyCoded(module.metadata, 'ResolutionScope', row[0], [0, 1, 26, 35], true);
  let target, scopeDepth = 1;
  if (scope === 1) target = namedTarget(module, module, 0, row);
  else if (scope >>> 24 === 35) {
    const assembly = module.assemblies.get(scope);
    target = assembly.reason ? assembly : namedTarget(module, assembly.module, 0, row);
  } else if (scope >>> 24 === 1) {
    const parent = referenceTarget(module, scope, modules, budget, depth + 1);
    scopeDepth += module.referenceDepths.get(scope);
    target = parent.reason ? parent : namedTarget(module, modules[parent.module], parent.type.token, row);
  } else target = { reason: scope ? 'module-reference' : 'nil-resolution-scope' };
  const result = target.reason ? deadReference(module, token, target.reason) : target;
  module.references.set(token, result);
  module.referenceDepths.set(token, scopeDepth);
  module.resolving.delete(token);
  return result;
}

function edge(module, token, modules, budget) {
  if (!token) return null;
  const table = token >>> 24;
  if (table === 2) return module.definitions.get(token);
  if (table === 1) return referenceTarget(module, token, modules, budget, 0);
  return deadReference(module, token, 'type-specification');
}

function bindEdges(module, modules, budget) {
  const target = coded => edge(module, hierarchyCoded(module.metadata, 'TypeDefOrRef', coded, [1, 2, 27], true), modules, budget);
  for (const node of module.definitions.values()) {
    budget.check();
    const base = target(module.metadata.row(node.type.token)[3]);
    if (base && (node.isInterface || base.isInterface)) invalidHierarchy('invalid class/interface base');
    node.base = base?.id ?? base;
  }
  const interfaces = new Set();
  for (const row of module.metadata.rows[9] ?? []) {
    budget.check();
    if (!Number.isInteger(row[0]) || row[0] < 1 || row[0] > 0xffffff) invalidHierarchy('InterfaceImpl owner');
    const owner = hierarchyToken(module.metadata, 0x02000000 + row[0], [2]);
    const key = owner + ':' + row[1];
    if (interfaces.has(key)) invalidHierarchy('duplicate InterfaceImpl');
    interfaces.add(key);
    const resolved = target(row[1]);
    if (!resolved || resolved.id && !resolved.isInterface) invalidHierarchy('InterfaceImpl target');
    module.definitions.get(owner).interfaces.push(resolved.id ?? resolved);
  }
}

/** Resolve temporary metadata/name indexes into owned IDs and adjacency; no PE or inspector survives. */
export function bindHierarchy(index, assemblies, budget) {
  const modules = assemblies.map((inspector, module) => moduleSnapshot(inspector, index, module, budget));
  const prefixes = new Set(modules.map(module => module.prefix));
  if (prefixes.size !== modules.length) invalidHierarchy('duplicate module');
  const indexed = index.modules();
  if (indexed.length !== modules.length || indexed.some(module => !prefixes.has('sf-metadata://' + module.mvid + '/')))
    invalidHierarchy('index module set differs');
  bindAssemblies(modules, budget);
  const nodes = new Map();
  for (const module of modules) {
    bindEdges(module, modules, budget);
    for (const node of module.definitions.values()) nodes.set(node.id, node);
  }
  return nodes;
}
