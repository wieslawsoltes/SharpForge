import { moduleManifest } from '../pe/modules.js';
import { assemblyReferenceRegistry } from './assembly-references.js';
import { MetadataHeaps } from './heaps.js';
import { definitionRowWriters } from './rows-definitions.js';
import { manifestRowWriters } from './rows-manifest.js';
import { interopRowWriters } from './rows-interop.js';
import { assemblyDefinitionRow } from './assembly-identity.js';

/** Initialize per-builder caches and manifest rows; no state is shared across compilations. */
export function initializeMetadataBuilder(builder, name, { framework = 'net8', uncompressed = false, extraData, ...identity }) {
  builder.name = name;
  builder.framework = framework;
  builder.uncompressed = uncompressed;
  builder.extraData = extraData;
  builder.rows = {};
  builder.heaps = new MetadataHeaps();
  builder.definitions = definitionRowWriters(builder);
  builder.manifest = manifestRowWriters(builder);
  builder.interop = interopRowWriters(builder);
  builder.typeRefs = new Map();
  builder.members = new Map();
  builder.assemblyRefs = new Map();
  builder.referenceIdentities = assemblyReferenceRegistry(identity.assemblyReferences);
  const module = moduleManifest(name, identity);
  builder.add(0, [0, builder.string(module.name), 1, 0, 0]);
  if (module.hasAssembly) builder.add(32, assemblyDefinitionRow(builder, identity));
}
