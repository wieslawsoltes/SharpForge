import {Op, FORMAT_VERSION, projectReferenceLimits, verifyImage} from '@sharpforge/bytecode';
import {projectWrappers} from './project-graph-wrappers.js';
import {checkProjectCancellation, requireProjectReference} from './project-reference-errors.js';
import {prepareProjectSourceLocations, projectSourceLocation} from './project-source-locations.js';
import {linkLocalProjectInstruction} from './project-graph-local-references.js';

function allocateModules(graph) {
  const counts = {types: 0, methods: 0, statics: 0, constants: 0, sequencePoints: 0};
  let instructions = 0;
  for (const module of graph.modules) {
    module.offsets = {...counts};
    for (const key of Object.keys(counts)) counts[key] += module.image[key].length;
    instructions += module.image.methods.reduce((sum, method) => sum + method.code.length / 3, 0);
    requireProjectReference(counts.types <= projectReferenceLimits.types && counts.methods <= projectReferenceLimits.methods
      && counts.statics <= projectReferenceLimits.fields && counts.constants <= 1_000_000
      && counts.sequencePoints <= 1_000_000 && instructions <= 1_000_000, 'PRJ0006', 'aggregate linked image budget');
  }
  return counts;
}

function append(target, values) {
  for (const value of values) target.push(value);
}

function linkTypes(module) {
  const {image, mapType, offsets, key} = module;
  const metadataNames = new Map(module.inspector.debug.types.map(type => [type.id, module.inspector.metadata.typeName(type.token)]));
  return image.types.map(type => ({...type, id: offsets.types + type.id, name: mapType(type.name),
    assemblyKey: key, metadataName: metadataNames.get(type.id),
    ...(typeof type.base === 'string' ? {base: mapType(type.base)} : {}),
    ...(typeof type.baseType === 'string' ? {baseType: mapType(type.baseType)} : {}),
    fields: type.fields.map(field => ({...field, type: mapType(field.type)})),
    ...(type.initializer === undefined ? {} : {initializer: offsets.methods + type.initializer}),
    ...(type.interfaces ? {interfaces: type.interfaces.map(mapType)} : {}),
    ...(type.properties ? {properties: type.properties.map(property => ({...property, type: mapType(property.type),
      get: property.get === null ? null : offsets.methods + property.get,
      set: property.set === null ? null : offsets.methods + property.set}))} : {}),
  }));
}

function linkStatics(module) {
  const {image, mapType, key} = module;
  return image.statics.map((field, index) => {
    const definition = module.inspector.fields.get(module.inspector.debug.statics[index]);
    return {...field, name: '[' + key + ']' + definition.owner + '.' + definition.name,
      type: mapType(field.type), assemblyKey: key};
  });
}

function linkMethod(module, method) {
  const {offsets, mapType, key} = module;
  return {...method, id: offsets.methods + method.id, qualifiedName: '[' + key + ']' + method.qualifiedName,
    owner: method.owner === null ? null : mapType(method.owner), returnType: mapType(method.returnType),
    parameters: method.parameters.map(parameter => ({...parameter, type: mapType(parameter.type)})),
    locals: method.locals.map(local => ({...local, type: mapType(local.type)})),
    handlers: method.handlers.map(handler => ({...handler})), code: new Int32Array(method.code),
    ...(method.sourceRange ? {sourceRange: projectSourceLocation(module, method.sourceRange)} : {}), assemblyKey: key};
}

function codeReferences(image, module, method, wrappers) {
  const code = method.code;
  const {offsets, bindings} = module;
  const typeConstants = new Map();
  function typeConstant(index) {
    if (!typeConstants.has(index)) {
      typeConstants.set(index, image.constants.length);
      image.constants.push(module.mapType(module.image.constants[index]));
    }
    return typeConstants.get(index);
  }
  for (let offset = 0; offset < code.length; offset += 3) {
    if (linkLocalProjectInstruction(module, code, offset, wrappers)) continue;
    const operation = code[offset];
    const argument = code[offset + 1];
    if (operation === Op.SEQ) code[offset + 1] += offsets.sequencePoints;
    else if (operation === Op.CONST) code[offset + 1] += offsets.constants;
    else if (operation === Op.NEWARR) code[offset + 1] = typeConstant(argument);
    else if (operation === Op.DELEGATE) {
      code[offset + 1] += offsets.methods;
      code[offset + 2] = typeConstant(code[offset + 2]);
    } else if (operation === Op.EXTCALL) {
      const binding = bindings.methods[argument];
      requireProjectReference(binding.source && binding.descriptor.name !== '.ctor', 'PRJ0005', 'ordinary external method mapping');
      code[offset] = Op.CALL;
      code[offset + 1] = wrappers.method(binding);
    } else if (operation === Op.EXTNEWOBJ) {
      code[offset] = Op.CALL;
      code[offset + 1] = wrappers.constructor(bindings.methods[argument]);
    } else if (operation === Op.EXTLDFLD || operation === Op.EXTSTFLD) {
      requireProjectReference(operation !== Op.EXTSTFLD || !bindings.fields[argument].isReadOnly,
        'PRJ0005', 'external write to an initonly field');
      code[offset] = operation === Op.EXTLDFLD ? Op.LDFLD : Op.STFLD;
      code[offset + 1] = bindings.fields[argument].index;
    } else if (operation === Op.EXTLDSTATIC || operation === Op.EXTSTSTATIC) {
      const store = operation === Op.EXTSTSTATIC;
      requireProjectReference(!store || !bindings.fields[argument].isReadOnly, 'PRJ0005', 'external write to an initonly field');
      code[offset] = Op.CALL;
      code[offset + 1] = wrappers.staticField(bindings.fields[argument], store);
      code[offset + 2] = store ? 1 : 0;
    }
  }
}

/** Build an in-memory execution view; no dependency TypeDef or method is emitted into another project's PE. */
export function linkProjectImage(graph, {signal} = {}) {
  allocateModules(graph);
  prepareProjectSourceLocations(graph.modules);
  const image = {formatVersion: FORMAT_VERSION, name: graph.entry.image.name,
    ...(graph.entry.image.outputKind === 'library' ? {outputKind: 'library'} : {}),
    entryPoint: graph.entry.image.entryPoint === null ? null : graph.entry.offsets.methods + graph.entry.image.entryPoint,
    types: [], methods: [], statics: [], constants: [], sequencePoints: [], sources: [],
    assemblies: graph.modules.map(module => ({key: module.key, identity: {...module.identity},
      resources: module.resources.map(resource => ({...resource})),
      assemblyAttributes: module.assemblyAttributes.map(attribute => ({...attribute}))}))};
  for (const module of graph.modules) {
    checkProjectCancellation(signal);
    append(image.types, linkTypes(module));
    append(image.statics, linkStatics(module));
    append(image.constants, module.image.constants);
    append(image.sequencePoints, module.image.sequencePoints.map(point => ({...projectSourceLocation(module, point),
      id: module.offsets.sequencePoints + point.id, methodId: module.offsets.methods + point.methodId, assemblyKey: module.key})));
    append(image.sources, module.image.sources.map(source => projectSourceLocation(module, source)));
    append(image.methods, module.image.methods.map(method => linkMethod(module, method)));
  }
  const wrappers = projectWrappers(image, projectReferenceLimits.methods);
  for (const module of graph.modules) {
    for (const method of module.image.methods) {
      checkProjectCancellation(signal);
      codeReferences(image, module, image.methods[module.offsets.methods + method.id], wrappers);
    }
  }
  requireProjectReference(image.constants.length <= 1_000_000
    && image.methods.reduce((sum, method) => sum + method.code.length / 3, 0) <= 1_000_000,
  'PRJ0006', 'linked adapter instruction or type constant budget');
  const errors = verifyImage(image);
  requireProjectReference(!errors.length, 'PRJ0005', 'linked source verification: ' + errors.join('; '));
  return image;
}
