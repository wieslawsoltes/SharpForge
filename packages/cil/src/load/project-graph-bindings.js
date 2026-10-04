import {readSignature} from '../metadata.js';
import {projectMetadataView, projectTypeMapper} from './project-graph-types.js';
import {projectGraphAccess} from './project-graph-access.js';
import {checkProjectCancellation, requireProjectReference} from './project-reference-errors.js';

function sourceMaps(module) {
  const {image, inspector} = module;
  const debug = inspector.debug;
  const types = new Map(debug.types.map(type => [type.token, image.types[type.id]]));
  const methods = new Map(debug.methods.map(method => [method.token, image.methods[method.id]]));
  const statics = new Map(debug.statics.map((token, index) => [token, index]));
  const fields = new Map();
  for (const definition of inspector.types) {
    const type = types.get(definition.token);
    if (!type) continue;
    let index = 0;
    for (const field of definition.fields) if (!field.isStatic) fields.set(field.token, {type, index: index++});
  }
  const constructors = new Map();
  const ensure = new Map();
  const typeInitializers = new Map();
  for (const method of image.methods) {
    if (method.name === '.ctor') {
      const key = method.owner + ':' + JSON.stringify(method.parameters.map(parameter => module.mapType(parameter.type)));
      constructors.set(key, method);
    }
    if (method.name === '<EnsureInitialized>' && method.isStatic && method.parameters.length === 0) ensure.set(method.owner, method);
    if (method.name === '.cctor' && method.isStatic && method.parameters.length === 0) typeInitializers.set(method.owner, method);
  }
  const typesByName = new Map(image.types.map(type => [type.name, type]));
  return {types, typesByName, methods, statics, fields, constructors, ensure, typeInitializers};
}

function methodBinding(target, type, original, mapType) {
  const descriptor = {...original, parameters: original.parameters.map(mapType), returnType: mapType(original.returnType)};
  const definition = target.inspector.methods.get(descriptor.token);
  requireProjectReference(definition && definition.ownerToken === type.definition.token && definition.hasBody,
    'PRJ0005', 'method owner or body: ' + descriptor.name);
  const row = target.inspector.metadata.row(descriptor.token);
  const signature = readSignature(target.inspector.metadata.blob(row[4]), target.qualifiedMetadata);
  requireProjectReference(definition.name === descriptor.name && signature.isStatic === descriptor.isStatic
    && signature.returnType === descriptor.returnType
    && JSON.stringify(signature.parameters) === JSON.stringify(descriptor.parameters),
  'PRJ0005', 'method signature: ' + descriptor.name);
  const source = descriptor.name === '.ctor'
    ? target.source.constructors.get(type.source.name + ':' + JSON.stringify(descriptor.parameters))
    : target.source.methods.get(descriptor.token);
  requireProjectReference(descriptor.name === '.ctor' || source, 'PRJ0005', 'missing source method mapping: ' + descriptor.name);
  return {module: target, type, descriptor, source, definition};
}

function fieldBinding(target, type, original, mapType) {
  const descriptor = {...original, fieldType: mapType(original.fieldType)};
  const definition = target.inspector.fields.get(descriptor.token);
  requireProjectReference(definition && definition.ownerToken === type.definition.token, 'PRJ0005', 'field owner: ' + descriptor.name);
  const row = target.inspector.metadata.row(descriptor.token);
  const signature = readSignature(target.inspector.metadata.blob(row[2]), target.qualifiedMetadata);
  requireProjectReference(definition.name === descriptor.name && definition.isStatic === descriptor.isStatic
    && signature.type === descriptor.fieldType, 'PRJ0005', 'field signature: ' + descriptor.name);
  const index = descriptor.isStatic ? target.source.statics.get(descriptor.token) : target.source.fields.get(descriptor.token)?.index;
  requireProjectReference(index !== undefined, 'PRJ0005', 'missing source field mapping: ' + descriptor.name);
  return {module: target, type, descriptor, index, definition, isReadOnly: !!(definition.flags & 0x20)};
}

/** Verify actual target TypeDef/MethodDef/FieldDef ownership and signatures after resolving full-identity closure. */
export function bindProjectGraph(graph, {signal} = {}) {
  const modules = new Map(graph.modules.map(module => [module.key.toLowerCase(), module]));
  const access = projectGraphAccess();
  for (const module of graph.modules) {
    module.mapType = projectTypeMapper(module, modules);
    module.qualifiedMetadata = projectMetadataView(module, modules);
    module.source = sourceMaps(module);
  }
  for (const module of graph.modules) {
    checkProjectCancellation(signal);
    const profile = module.image.externalReferences;
    module.bindings = {types: [], methods: [], fields: []};
    module.references = {types: [], methods: [], fields: []};
    if (!profile) continue;
    const referenceTokens = module.inspector.debug.referenceTokens;
    module.bindings.types = profile.types.map((descriptor, index) => {
      const target = modules.get(profile.assemblies[descriptor.assembly].key.toLowerCase());
      const source = target.source.types.get(descriptor.token);
      const definition = target.inspector.types[(descriptor.token & 0xffffff) - 1];
      requireProjectReference(source && definition?.token === descriptor.token && definition.name === descriptor.name,
        'PRJ0005', 'type definition: ' + descriptor.name);
      access.type(module, target, definition);
      module.references.types.push({token: referenceTokens.types[index], targetKey: target.key, targetToken: descriptor.token});
      return {module: target, descriptor, source, definition};
    });
    for (const [kind, bind] of [['methods', methodBinding], ['fields', fieldBinding]]) {
      module.bindings[kind] = profile[kind].map((descriptor, index) => {
        const type = module.bindings.types[descriptor.type];
        const target = type.module;
        module.references[kind].push({token: referenceTokens[kind][index], targetKey: target.key, targetToken: descriptor.token});
        const binding = bind(target, type, descriptor, module.mapType);
        access.member(module, target, binding.definition);
        return binding;
      });
    }
  }
  return graph;
}
