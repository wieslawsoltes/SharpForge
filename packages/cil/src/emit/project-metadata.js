import {Writer, CilError, utf8} from '../binary.js';
import {codedIndex, token, methodSignature} from '../metadata.js';
import {emissionTypeDescriptors} from './type-descriptors.js';
import {normalizeAssemblyVersion} from '../metadata/assembly-identity.js';

const stringAttributes = new Set([
  'System.Reflection.AssemblyCompanyAttribute', 'System.Reflection.AssemblyConfigurationAttribute',
  'System.Reflection.AssemblyCopyrightAttribute', 'System.Reflection.AssemblyDescriptionAttribute',
  'System.Reflection.AssemblyFileVersionAttribute', 'System.Reflection.AssemblyInformationalVersionAttribute',
  'System.Reflection.AssemblyProductAttribute', 'System.Reflection.AssemblyTitleAttribute',
  'System.Resources.NeutralResourcesLanguageAttribute', 'System.Runtime.CompilerServices.InternalsVisibleToAttribute',
  'System.Runtime.Versioning.TargetFrameworkAttribute',
]);
const versionAttribute = 'System.Reflection.AssemblyVersionAttribute';
const friendAttribute = 'System.Runtime.CompilerServices.InternalsVisibleToAttribute';

function versionParts(value) {
  if (!/^\d+(?:\.\d+){1,3}$/.test(value)) throw new CilError('AssemblyVersion must be a deterministic numeric version');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isInteger(part) || part > 65534)) throw new CilError('AssemblyVersion component exceeds UInt16');
  while (parts.length < 4) parts.push(0);
  return parts;
}

/** Emit the documented SDK string-attribute subset as real CLI metadata, without executing source attributes. */
export function emitProjectAttributes(metadata, options = {}) {
  const attributes = options.assemblyAttributes ?? [];
  if (!Array.isArray(attributes) || attributes.length > 256) throw new CilError('Assembly attribute count limit exceeded');
  if (attributes.length && metadata.rows[32]?.length !== 1) throw new CilError('Assembly attributes require an Assembly manifest');
  const seen = new Set();
  let size = 0;
  for (const attribute of attributes) {
    const {type, value} = attribute ?? {};
    if (typeof value !== 'string' || type !== versionAttribute && !stringAttributes.has(type)) {
      throw new CilError('Unsupported generated assembly attribute: ' + type);
    }
    const encoded = utf8(value);
    size += encoded.length;
    if (size > 1024 * 1024) throw new CilError('Assembly attribute byte limit exceeded');
    if (type !== friendAttribute && seen.has(type)) throw new CilError('Duplicate generated assembly attribute: ' + type);
    seen.add(type);
    if (type === versionAttribute) {
      const version = versionParts(value);
      if (options.assemblyVersion !== undefined && normalizeAssemblyVersion(options.assemblyVersion).some((part, index) => part !== version[index])) {
        throw new CilError('AssemblyVersion attribute conflicts with the explicit assembly version');
      }
      metadata.rows[32][0].splice(1, 4, ...version);
      continue;
    }
    const owner = metadata.typeRef(type);
    const constructor = metadata.member(owner, '.ctor', methodSignature('void', ['string'], false, name => metadata.typeRef(name)));
    const payload = new Writer().u16(1).compressed(encoded.length).bytes(encoded).u16(0).finish();
    metadata.add(12, [codedIndex('HasCustomAttribute', token(32, 1)),
      codedIndex('CustomAttributeType', constructor), metadata.blob(payload)]);
  }
}

/** Keep compiler identities for method lookup while emitting explicit source namespace and accessibility. */
export function projectTypeDescriptors(image, definitions, options = {}) {
  if (definitions !== undefined && (!definitions || typeof definitions !== 'object' || Array.isArray(definitions))) {
    throw new CilError('Invalid project type definitions');
  }
  const descriptors = emissionTypeDescriptors(image, options);
  for (const descriptor of descriptors) {
    const type = descriptor.original;
    if (!type) continue;
    const definition = definitions && Object.hasOwn(definitions, type.name) ? definitions[type.name] : null;
    if (definition !== null && (!definition || !['public', 'internal'].includes(definition.access)
      || typeof definition.name !== 'string' || !definition.name || definition.name.length > 1024
      || typeof definition.namespace !== 'string' || definition.namespace.length > 1024
      || /[\0\r\n/\\]/.test(definition.name + definition.namespace))) throw new CilError('Invalid project type definition');
    const visible = definitions === undefined || definition?.access === 'public';
    descriptor.metadataName = definition?.name ?? type.name;
    descriptor.namespace = definition?.namespace ?? '';
    descriptor.flags = (descriptor.flags & ~1) | (visible ? 1 : 0);
  }
  return descriptors;
}

/** Adapt SDK resource records to the shared managed-resource writer without creating a second CLI directory. */
export function projectManagedResources(options) {
  const resources = options.resources ?? [];
  if (!Array.isArray(resources) || resources.length > 4096) throw new CilError('Manifest resource count limit exceeded');
  if (!resources.length) return options.managedResources ?? [];
  if (options.managedResources?.length) throw new CilError('Specify project resources or managed resources, not both');
  const names = new Set();
  let total = 0;
  for (const resource of resources) {
    if (typeof resource.manifestName !== 'string' || !resource.manifestName || resource.manifestName.length > 1024
      || resource.manifestName.includes('\0') || names.has(resource.manifestName)) throw new CilError('Invalid or duplicate resource name');
    if (!(resource.bytes instanceof Uint8Array)) throw new CilError('Manifest resource requires bytes');
    names.add(resource.manifestName);
    total += resource.bytes.length + 12;
    if (total > 64 * 1024 * 1024) throw new CilError('Manifest resource byte limit exceeded');
  }
  return resources.map(resource => ({name: resource.manifestName, bytes: resource.bytes,
    visibility: resource.isPublic === false ? 'private' : 'public'}));
}
