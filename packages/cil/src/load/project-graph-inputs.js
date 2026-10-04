import {projectAssemblyKey, projectReferenceLimits} from '@sharpforge/bytecode';
import {AssemblyInspector} from '../inspector.js';
import {loadAssembly} from '../loader.js';
import {sha256} from '../binary/hash.js';
import {AssemblyIdentity} from '../assembly-identity.js';
import {readManagedResources} from '../pe/managed-resources.js';
import {checkProjectCancellation, projectReferenceError, requireProjectReference} from './project-reference-errors.js';

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

function bytesOf(input) {
  const bytes = input?.assembly ?? input?.bytes ?? input;
  requireProjectReference(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer,
    'PRJ0001', 'project assembly inputs require PE bytes');
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  requireProjectReference(view.byteLength > 0 && view.byteLength <= projectReferenceLimits.assemblyBytes,
    'PRJ0006', 'project assembly byte limit');
  return view;
}

function identityOf(inspector) {
  const {metadata} = inspector;
  const rows = metadata.rows[32];
  requireProjectReference(rows?.length === 1, 'PRJ0001', 'one Assembly definition is required');
  const row = rows[0];
  requireProjectReference(row[5] === 0 && metadata.blob(row[6]).length === 0,
    'PRJ0001', 'closed project execution supports unsigned, non-retargetable ordinary assemblies');
  const identity = new AssemblyIdentity({name: metadata.string(row[7]), version: row.slice(1, 5),
    cultureName: metadata.string(row[8])});
  return {name: identity.name, version: [...identity.version], cultureName: identity.cultureName,
    publicKeyToken: identity.publicKeyToken, isRetargetable: identity.isRetargetable, contentType: identity.contentType};
}

function inspectModule(input, view, options) {
  checkProjectCancellation(options.signal);
  // Both decoders read the same owned snapshot; later caller writes cannot change verified CIL.
  const bytes = new Uint8Array(view);
  let image;
  try {
    image = loadAssembly(bytes, options.assemblyLimits);
  } catch (error) {
    if (error.code?.startsWith('PRJ')) throw error;
    throw projectReferenceError('PRJ0001', String(error.message).slice(0, 1024));
  }
  const inspector = new AssemblyInspector(bytes, options.assemblyLimits);
  const identity = identityOf(inspector);
  const key = projectAssemblyKey(identity);
  const digest = hex(sha256(bytes));
  checkProjectCancellation(options.signal);
  const resources = readManagedResources(inspector.pe);
  const assemblyAttributes = (inspector.debug.projectMetadata?.assemblyAttributes ?? []).map(attribute => ({...attribute}));
  return {key, identity, sha256: digest, bytes, image, inspector, resources, assemblyAttributes, dependencies: [],
    ...(typeof input?.project === 'string' ? {project: input.project} : {}),
    ...(typeof input?.contextId === 'string' ? {contextId: input.contextId} : {})};
}

/** Validate every supplied artifact once, then resolve a deterministic dependency-first closure. */
export function readProjectGraph(assembly, options = {}) {
  const dependencies = options.dependencies ?? [];
  requireProjectReference(Array.isArray(dependencies) && dependencies.length <= projectReferenceLimits.assemblies,
    'PRJ0006', 'supplied project assembly count');
  checkProjectCancellation(options.signal);
  const modules = new Map();
  const snapshots = new Map();
  let totalBytes = 0;
  let entry;
  for (const [index, input] of [assembly, ...dependencies].entries()) {
    const view = bytesOf(input);
    let module = snapshots.get(view);
    if (!module) {
      totalBytes += view.byteLength;
      requireProjectReference(totalBytes <= projectReferenceLimits.totalBytes, 'PRJ0006', 'aggregate project assembly byte limit');
      module = inspectModule(input, view, options);
      const lookup = module.key.toLowerCase();
      const prior = modules.get(lookup);
      requireProjectReference(!prior || prior.sha256 === module.sha256, 'PRJ0004', module.key);
      if (prior) module = prior;
      else modules.set(lookup, module);
      snapshots.set(view, module);
      requireProjectReference(modules.size <= projectReferenceLimits.assemblies, 'PRJ0006', 'unique project assembly count');
    }
    if (index === 0) entry = module;
  }
  const ordered = [];
  const completed = new Set();
  const active = new Set();
  function visit(module) {
    checkProjectCancellation(options.signal);
    if (completed.has(module.key)) return;
    requireProjectReference(!active.has(module.key), 'PRJ0006', 'cyclic project assembly graph');
    active.add(module.key);
    for (const reference of module.image.externalReferences?.assemblies ?? []) {
      const target = modules.get(reference.key.toLowerCase());
      requireProjectReference(target, 'PRJ0002', reference.key);
      requireProjectReference(target.key.toLowerCase() === reference.key.toLowerCase()
        && target.sha256 === reference.sha256, 'PRJ0003', reference.key);
      module.dependencies.push(target.key);
      visit(target);
    }
    active.delete(module.key);
    completed.add(module.key);
    ordered.push(module);
  }
  visit(entry);
  return {modules: ordered, entryKey: entry.key, entry};
}
