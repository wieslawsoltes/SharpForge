import {debugPEOptions} from './pe-options.js';

/** Record non-executable emission choices so the loader can verify the complete canonical artifact. */
function projectProfile(options, descriptors) {
  const profile = {version: 1};
  if (options.assemblyAttributes?.length) {
    profile.assemblyAttributes = options.assemblyAttributes.map(({type, value}) => ({type, value}));
  }
  if (options.typeDefinitions !== undefined) {
    profile.types = descriptors.filter(type => type.original).map(type => ({
      id: type.original.id, name: type.metadataName, namespace: type.namespace,
      access: type.flags & 1 ? 'public' : 'internal',
    }));
  }
  if (options.memberDefinitions !== undefined) profile.memberDefinitions = options.memberDefinitions;
  if (options.resources?.length) {
    profile.resources = options.resources.map(resource => ({
      manifestName: resource.manifestName, isPublic: resource.isPublic !== false, length: resource.bytes.length,
    }));
  }
  return Object.keys(profile).length > 1 ? {projectMetadata: profile} : {};
}

/** Build debug boundaries without embedding opcodes or duplicating managed resource bytes. */
export function emissionDebugProfile({image, framework, name, peOptions, context, debugMethods,
  embedSources, projectOptions, typeDescriptors}) {
  debugMethods.sort((first, second) => first.id - second.id);
  return {
    format: 'SharpForge.CIL', version: 1, framework, name, ...debugPEOptions(peOptions),
    ...projectProfile(projectOptions, typeDescriptors), entry: image.entryPoint,
    ...(context.projectInitialization ? {projectInitialization: 1} : {}),
    ...(image.externalReferences ? {externalReferences: image.externalReferences, referenceTokens: context.projectReferences} : {}),
    ...(image.outputKind === 'library' ? {outputKind: 'library'} : {}),
    types: image.types.map(type => ({id: type.id, token: context.typeTokens.get(type.name), initializer: type.initializer})),
    statics: context.staticTokens, methods: debugMethods,
    sequencePoints: image.sequencePoints.map(point => ({...point,
      ilOffset: debugMethods[point.methodId].spans[point.offset][0], methodToken: context.methodTokens.get(point.methodId)})),
    sources: image.sources.map(source => embedSources ? source : {uri: source.uri, version: source.version}),
  };
}
