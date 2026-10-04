import { CilError } from '@sharpforge/cil';

const maximumFiles = 20000;
const maximumDeclarations = 100000;

function sourceDeclarations(parsedFiles) {
  if (!Array.isArray(parsedFiles) || parsedFiles.length > maximumFiles) {
    throw new CilError('Source type metadata requires at most 20000 parsed files');
  }
  const fullNames = new Map();
  const simpleNames = new Map();
  let count = 0;
  for (const file of parsedFiles) {
    if (!Array.isArray(file?.root?.members)) throw new CilError('Source type metadata requires parsed compilation units');
    for (const declaration of file.root.members) {
      if (declaration.kind !== 'Class') continue;
      if (++count > maximumDeclarations) throw new CilError('Source type declaration limit exceeded');
      const namespace = declaration.namespace ?? '';
      const fullName = (namespace ? namespace + '.' : '') + declaration.name;
      const previous = fullNames.get(fullName);
      const definition = { name: declaration.name, namespace,
        access: previous?.access === 'public' || declaration.modifiers.includes('public') ? 'public' : 'internal' };
      fullNames.set(fullName, definition);
      const candidates = simpleNames.get(declaration.name) ?? new Set();
      candidates.add(fullName);
      simpleNames.set(declaration.name, candidates);
    }
  }
  return { fullNames, simpleNames };
}

/**
 * Map emitted image identities to explicit source TypeDef names, namespaces and public/internal access.
 * Accept already parsed compilation units; no source is reparsed. Partial declarations share one definition.
 * Semantic IR uses full source names; legacy IR may use an unambiguous simple name. Generated identities are
 * opaque and stay internal. Malformed input or more than 20000 files/100000 declarations throws CilError.
 */
export function sourceTypeDefinitions(parsedFiles, image) {
  if (!Array.isArray(image?.types) || image.types.length > maximumDeclarations) {
    throw new CilError('Invalid image types or source type definition limit exceeded');
  }
  const { fullNames, simpleNames } = sourceDeclarations(parsedFiles);
  const definitions = Object.create(null);
  for (const type of image.types) {
    let definition = fullNames.get(type.name);
    if (!definition) {
      const candidates = simpleNames.get(type.name);
      if (candidates?.size === 1) definition = fullNames.get(candidates.values().next().value);
    }
    definitions[type.name] = definition ? { ...definition } : { name: type.name, namespace: '', access: 'internal' };
  }
  return definitions;
}
