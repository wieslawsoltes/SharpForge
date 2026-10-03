import { CilError } from '../binary.js';

export function normalizeAssemblyVersion(value = [0, 2, 0, 0]) {
  const components = typeof value === 'string' && value.length <= 23 && /^\d+\.\d+\.\d+\.\d+$/.test(value)
    ? value.split('.').map(Number) : value;
  if (!Array.isArray(components) || components.length !== 4) {
    throw new CilError('Assembly version must contain four UInt16 components; wildcards are unsupported');
  }
  for (const part of components) {
    if (!Number.isInteger(part) || part < 0 || part > 65535) throw new CilError('Assembly version components must be UInt16');
  }
  return [...components];
}

export function normalizeAssemblyCulture(value = '') {
  if (typeof value !== 'string' || value.length > 85 || value && !/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/.test(value)) {
    throw new CilError('Assembly culture must be an empty invariant culture or a bounded culture tag');
  }
  return value === 'neutral' ? '' : value;
}

/** Build an Assembly row from explicit version/culture options, retaining existing defaults. */
export function assemblyDefinitionRow(builder, options) {
  const version = normalizeAssemblyVersion(options.assemblyVersion), culture = normalizeAssemblyCulture(options.assemblyCulture);
  return [0x8004, ...version, 0, 0, builder.string(builder.name), builder.string(culture)];
}

/** Reconstruct definition identity from metadata for canonical source replay. */
export function assemblyDefinitionOptions(metadata) {
  const rows = metadata.rows[32];
  if (!rows?.length) throw new CilError('Netmodules require a containing assembly; standalone execution is unsupported');
  if (rows.length !== 1) throw new CilError('Canonical source replay requires exactly one Assembly definition');
  return { assemblyVersion: normalizeAssemblyVersion(rows[0].slice(1, 5)), assemblyCulture: normalizeAssemblyCulture(metadata.string(rows[0][8])) };
}
