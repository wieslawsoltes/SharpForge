import {AssemblyInspector, CilError, decodeCoded, readSignature, readManagedResources, loadProjectAssembly} from '@sharpforge/cil';
import {projectReferenceLimits} from '@sharpforge/bytecode';
import {ProjectMetadata} from './metadata.js';
import {typeReferenceScope, scopedTypeName, memberKey} from './identities.js';
import {projectDebugInfo} from './debug-info.js';

function runtimeModules(graph) {
  const entry = graph.modules.find(module => module.key === graph.entryKey);
  if (!entry) throw new CilError('The project assembly graph has no entry module');
  const ordered = [entry, ...graph.modules.filter(module => module !== entry)];
  let types = 0;
  let methods = 0;
  let fields = 0;
  return ordered.map((module, index) => {
    const {bytes, inspector} = module;
    types += inspector.types.length;
    methods += inspector.methods.size;
    fields += inspector.fields.size;
    if (types > projectReferenceLimits.types || methods > projectReferenceLimits.methods || fields > projectReferenceLimits.fields) {
      throw Object.assign(new CilError('Project runtime declaration limit exceeded'), {code: 'PRJ0006'});
    }
    return {...module, index, bytes, inspector, dependencies: new Set(module.dependencies),
      references: new Map(Object.values(module.references).flat().map(reference => [reference.token, reference])),
      definitions: new Map(inspector.types.map(type => [type.name, type.token]))};
  });
}

/** Original verified CIL methods share one heap and token space; no module executes in a nested VM. */
class ProjectAssemblyInspector extends AssemblyInspector {
  constructor(graph, options) {
    const modules = runtimeModules(graph);
    super(modules[0].bytes, options);
    this.modules = modules;
    this.moduleKeys = new Map(modules.map(module => [module.key, module]));
    this.localViews = new Map();
    this.typeNames = new Map();
    this.signatures = new Map();
    this.resolved = new Map();
    this.cache = new Map();
    this.types = [];
    this.methods = new Map();
    this.fields = new Map();
    this.owners = new Map();
    this.typeIndex = new Map();
    this.members = new Map();
    this.metadata = new ProjectMetadata(modules, (module, value, depth) => this.moduleTypeName(module, value, depth));
    this.pe = modules[0].inspector.pe;
    this.buildDeclarations();
    const debug = projectDebugInfo(modules, this.metadata);
    this.debug = debug.debug;
    this.sourcePoints = debug.points;
    this.methodIds = debug.methodIds;
    this.projectAssemblies = modules.map(module => ({key: module.key, identity: module.identity, bytes: module.bytes.length}));
    this.projectImage = graph.image;
  }

  summary(options = {}) {
    return {...super.summary(options), format: 'ECMA-335 project execution graph',
      bytes: this.modules.reduce((sum, module) => sum + module.bytes.length, 0),
      assemblies: this.projectAssemblies, entryAssembly: this.modules[0].key,
      resources: this.modules.flatMap(module => readManagedResources(module.inspector.pe)
        .map(resource => ({...resource, assemblyKey: module.key})))};
  }

  moduleForReference(module, value) {
    const reference = module.references.get(value);
    if (reference) return this.moduleKeys.get(reference.targetKey);
    const metadata = module.inspector.metadata;
    const scope = typeReferenceScope(metadata, value);
    if (!scope || scope >>> 24 === 0) return module;
    return null;
  }

  resolvedType(module, value) {
    if (value >>> 24 === 2) return this.metadata.mapToken(module, value);
    if (value >>> 24 !== 1) return null;
    const reference = module.references.get(value);
    if (reference) return this.metadata.mapToken(this.moduleKeys.get(reference.targetKey), reference.targetToken);
    const target = this.moduleForReference(module, value);
    if (!target) return null;
    const name = module.inspector.metadata.typeName(value);
    const definition = target.definitions.get(name);
    if (!definition) throw new CilError('Project type is absent from its declared assembly: ' + name);
    return this.metadata.mapToken(target, definition);
  }

  moduleTypeName(module, value, depth = 0) {
    if (depth > 64) throw new CilError('Project type nesting limit exceeded');
    const key = module.index + ':' + value;
    if (this.typeNames.has(key)) return this.typeNames.get(key);
    const metadata = module.inspector.metadata;
    const table = value >>> 24;
    let name;
    if (table === 2) name = scopedTypeName(module, metadata.typeName(value));
    else if (table === 1) {
      const target = this.moduleForReference(module, value);
      name = metadata.typeName(value);
      if (target) {
        if (!target.definitions.has(name)) throw new CilError('Project TypeRef has no definition: ' + name);
        name = scopedTypeName(target, name);
      }
    } else if (table === 27) name = metadata.typeName.call(this.localMetadata(module), value, depth + 1);
    else throw new CilError('Expected a project type token');
    this.typeNames.set(key, name);
    return name;
  }

  localMetadata(module) {
    if (!this.localViews.has(module)) this.localViews.set(module, {
      ...module.inspector.metadata,
      typeName: (value, depth = 0) => this.moduleTypeName(module, value, depth)
    });
    return this.localViews.get(module);
  }

  signature(value) {
    if (this.signatures.has(value)) return this.signatures.get(value);
    const {module, local} = this.metadata.location(value);
    const table = local >>> 24;
    const row = module.inspector.metadata.row(local);
    const column = table === 43 ? 1 : table === 6 ? 4 : [4, 10, 23].includes(table) ? 2 : 0;
    const signature = readSignature(module.inspector.metadata.blob(row[column]), this.localMetadata(module));
    this.signatures.set(value, signature);
    return signature;
  }

  buildDeclarations() {
    for (const module of this.modules) {
      const map = value => this.metadata.mapToken(module, value);
      for (const original of module.inspector.types) {
        const type = {...original, token: map(original.token), name: scopedTypeName(module, original.name),
          metadataName: original.name, assemblyKey: module.key,
          baseToken: this.resolvedType(module, original.baseToken) ?? map(original.baseToken),
          interfaces: original.interfaces.map(value => this.resolvedType(module, value) ?? map(value)),
          fields: [], methods: [], properties: original.properties.map(property => ({...property, token: map(property.token)})),
          events: original.events.map(event => ({...event, token: map(event.token)}))};
        this.types.push(type);
        this.typeIndex.set(type.token, type);
        for (const [kind, declarations] of [['field', original.fields], ['method', original.methods]]) {
          for (const declaration of declarations) {
            const value = {...declaration, token: map(declaration.token), owner: type.name, ownerToken: type.token,
              originalToken: declaration.token, assemblyKey: module.key};
            this.owners.set(value.token, type);
            const collection = kind === 'field' ? this.fields : this.methods;
            collection.set(value.token, value);
            type[kind === 'field' ? 'fields' : 'methods'].push(value);
          }
        }
      }
    }
    for (const type of this.types) {
      const index = new Map();
      for (const declaration of [...type.fields, ...type.methods]) {
        const key = memberKey(declaration.name, this.signature(declaration.token));
        const matches = index.get(key) ?? [];
        matches.push(declaration);
        index.set(key, matches);
      }
      this.members.set(type.token, index);
    }
  }

  resolveToken(value, depth = 0) {
    if (this.resolved.has(value)) return this.resolved.get(value);
    if (depth > 64) throw new CilError('Project member recursion limit exceeded');
    const table = value >>> 24;
    const {module, local} = this.metadata.location(value);
    const row = table === 0x70 ? null : module.inspector.metadata.row(local);
    let descriptor;
    if (table === 0x70) descriptor = {kind: 'string', token: value, value: this.metadata.userString(value)};
    else if ([1, 2, 27].includes(table)) descriptor = {kind: 'type', token: value,
      name: this.metadata.typeName(value), resolvedToken: this.resolvedType(module, local) ?? undefined};
    else if (table === 4 || table === 6) descriptor = {...(table === 4 ? this.fields : this.methods).get(value),
      kind: table === 4 ? 'field' : 'method', signature: this.signature(value)};
    else if (table === 10) descriptor = this.resolveMember(module, local, value);
    else if (table === 43) {
      const definition = this.metadata.mapToken(module, decodeCoded('MethodDefOrRef', row[0]));
      descriptor = {...this.resolveToken(definition, depth + 1), token: value,
        definitionToken: definition, genericArguments: this.signature(value).arguments};
    } else if (table === 17) descriptor = {kind: 'signature', token: value, signature: this.signature(value)};
    else descriptor = {kind: 'metadata', token: value, row: this.metadata.row(value)};
    this.resolved.set(value, descriptor);
    return descriptor;
  }

  resolveMember(module, local, value) {
    const reference = module.references.get(local);
    if (reference) {
      const target = this.metadata.mapToken(this.moduleKeys.get(reference.targetKey), reference.targetToken);
      const definition = this.fields.get(target) ?? this.methods.get(target);
      return {...definition, kind: target >>> 24 === 4 ? 'field' : 'method', token: value,
        resolvedToken: target, signature: this.signature(value)};
    }
    const metadata = module.inspector.metadata;
    const row = metadata.row(local);
    const parent = decodeCoded('MemberRefParent', row[0]);
    if (![1, 2, 27].includes(parent >>> 24)) throw new CilError('Unsupported project MemberRef parent');
    const ownerToken = this.resolvedType(module, parent) ?? this.metadata.mapToken(module, parent);
    const owner = this.moduleTypeName(module, parent);
    const signature = this.signature(value);
    const name = metadata.string(row[1]);
    const candidates = this.members.get(ownerToken)?.get(memberKey(name, signature)) ?? [];
    if (this.typeIndex.has(ownerToken) && candidates.length !== 1) {
      throw new CilError('Project member is missing or ambiguous: ' + owner + '::' + name);
    }
    return {kind: signature.kind, name, owner, ownerToken, token: value, signature, resolvedToken: candidates[0]?.token};
  }

  getMethod(value) {
    if (this.cache.has(value)) return this.cache.get(value);
    const {module, local} = this.metadata.location(value);
    const original = module.inspector.getMethod(local);
    const method = {...original, ...this.methods.get(value), signature: this.signature(value),
      id: this.methodIds.get(value) ?? null,
      locals: original.localSignature ? this.signature(this.metadata.mapToken(module, original.localSignature)).types : [],
      localSignature: this.metadata.mapToken(module, original.localSignature ?? 0),
      handlers: original.handlers.map(handler => ({...handler, catchType: this.metadata.mapToken(module, handler.catchType ?? 0)})),
      instructions: original.instructions.map(instruction => {
        const operand = instruction.operandKind === 'token' ? this.metadata.mapToken(module, instruction.operand) : instruction.operand;
        return {...instruction, operand, operandText: instruction.operandKind === 'token' ? this.describeToken(operand) : instruction.operandText,
          point: instruction.point ? this.sourcePoints.get(module.index + ':' + instruction.point.id) : null};
      })};
    this.cache.set(value, method);
    return method;
  }
}

/** Verify the explicit canonical dependency closure before admitting it to the ordinary direct CIL VM. */
export function createProjectAssemblyInspector(assembly, options = {}) {
  const graph = loadProjectAssembly(assembly, options);
  return new ProjectAssemblyInspector(graph, options);
}
