import {emitAssemblyDetailed} from '@sharpforge/cil';
import {sourceTypeDefinitions as compilerTypeDefinitions, sourceMemberDefinitions as compilerMemberDefinitions} from '@sharpforge/compiler';

/** Derive source declaration metadata from the already parsed compiler documents. */
export function sourceTypeDefinitions(workspace, image) {
  return compilerTypeDefinitions([...workspace.documents.keys()].map(uri => workspace.syntax(uri)), image);
}

/** Preserve source member accessibility across project assembly boundaries without copying dependency source. */
export function sourceMemberDefinitions(workspace, image) {
  return compilerMemberDefinitions([...workspace.documents.keys()].map(uri => workspace.syntax(uri)), image);
}

/** Metadata generation is deliberately limited to structured SDK-generated source records. */
export function projectEmissionInputs(unit) {
  const generated = unit.sources.filter(source => source.generated && source.kind === 'assembly-info');
  const attributes = unit.assemblyAttributes ?? generated.flatMap(source => source.assemblyAttributes ?? []);
  if (generated.length && (!attributes.length || generated.some(source => !Array.isArray(source.assemblyAttributes)))) {
    throw new Error('Generated AssemblyInfo requires its structured attribute metadata');
  }
  return {sources: unit.sources.filter(source => !generated.includes(source)), generated,
    options: {assemblyAttributes: attributes, resources: (unit.resources ?? []).filter(resource => !resource.culture)}};
}

/** Each culture receives a resource-only satellite; neutral resources stay in the project's main assembly. */
export function emitProjectSatellites(unit, image) {
  const groups = new Map();
  for (const resource of unit.resources ?? []) {
    if (!resource.culture) continue;
    const list = groups.get(resource.culture) ?? [];
    list.push(resource);
    groups.set(resource.culture, list);
  }
  if (!groups.size) return [];
  const empty = {...image, outputKind: 'library', entryPoint: null, constants: [], sequencePoints: [], sources: [],
    types: [], statics: [], methods: []};
  const directory = String(unit.output).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const name = unit.assemblyName + '.resources';
  const assemblyAttributes = (unit.assemblyAttributes ?? []).filter(attribute => attribute.type.endsWith('.AssemblyVersionAttribute'));
  return [...groups].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([culture, resources]) => ({
    culture, output: (directory ? directory + '/' : '') + culture + '/' + name + '.dll',
    manifestNames: resources.map(resource => resource.manifestName),
    assembly: emitAssemblyDetailed(empty, {name, assemblyCulture: culture, assemblyAttributes, resources, includeDebug: false}).bytes,
  }));
}
