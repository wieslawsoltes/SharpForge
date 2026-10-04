import { loadAssembly, sha256 } from '@sharpforge/cil';
import { projectReferenceLimits } from '@sharpforge/bytecode';
import { TypeKind } from '../../symbols/types.js';

const ownerOf = symbol => symbol?.typeKind ? symbol : symbol?.containingType ?? symbol?.containingSymbol;
const assemblyOf = symbol => symbol?.containingAssembly ?? ownerOf(symbol)?.containingAssembly;
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

/** Per-compilation references to canonical, explicitly supplied SharpForge PE artifacts. */
export class ProjectReferences {
  constructor(generator, references = []) {
    this.generator = generator;
    this.inputs = references.filter(reference => reference.runtimeProfile === 'sharpforge');
    this.allowed = new Set(this.inputs.flatMap(reference => [reference.assembly, reference.bytes]).filter(Boolean));
    this.assemblyIds = new Map();
    this.typeIds = new Map();
    this.methodIds = new Map();
    this.fieldIds = new Map();
    this.keys = new Map();
    this.data = { format: 'SharpForge.ProjectReferences/1', assemblies: [], types: [], methods: [], fields: [] };
  }

  validateInput() {
    if (this.inputs.length > projectReferenceLimits.assemblies) this.fail('too many supplied project assemblies');
    const seen = new Set();
    let total = 0;
    for (const reference of this.inputs) {
      const bytes = reference.bytes ?? reference.assembly?.metadata?.pe?.bytes;
      if (!(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer)) this.fail('a project reference without PE bytes');
      if (seen.has(bytes)) continue;
      seen.add(bytes);
      const length = bytes.byteLength;
      if (length > projectReferenceLimits.assemblyBytes) this.fail('a supplied project assembly exceeding its byte budget');
      total += length;
      if (total > projectReferenceLimits.totalBytes) this.fail('supplied project assemblies exceeding their aggregate byte budget');
    }
  }

  fail(message, syntax = null) {
    return this.generator.unsupported('project assembly execution: ' + message, syntax);
  }

  handles(symbol) {
    const assembly = assemblyOf(symbol);
    const bytes = assembly?.metadata?.pe?.bytes;
    return !!bytes && (this.allowed.has(assembly) || this.allowed.has(bytes)
      || bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && this.allowed.has(bytes.buffer));
  }

  name(value, syntax) {
    if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) {
      this.fail('an invalid or excessively long metadata identity', syntax);
    }
    return value;
  }

  assembly(assembly, syntax) {
    if (this.assemblyIds.has(assembly)) return this.assemblyIds.get(assembly);
    const bytes = assembly.metadata.pe.bytes;
    if (bytes.byteLength > projectReferenceLimits.assemblyBytes) this.fail('a project assembly exceeding its byte budget', syntax);
    try {
      // Verification reads real method bodies and checks canonical re-emission; a #SF marker alone is insufficient.
      loadAssembly(bytes);
    } catch (error) {
      this.fail('the supplied PE is outside the canonical SharpForge profile (' + String(error.message).slice(0, 512) + ')', syntax);
    }
    const identity = assembly.identity;
    const key = this.name(identity.getDisplayName(), syntax);
    const digest = hex(sha256(bytes));
    const existing = this.keys.get(key);
    if (existing !== undefined) {
      if (this.data.assemblies[existing].sha256 !== digest) this.fail('conflicting PE bytes for assembly ' + key, syntax);
      this.assemblyIds.set(assembly, existing);
      return existing;
    }
    const index = this.data.assemblies.length;
    if (index >= projectReferenceLimits.assemblies) this.fail('too many referenced project assemblies', syntax);
    this.data.assemblies.push({ identity: { name: identity.name, version: [...identity.version],
      cultureName: identity.cultureName, publicKeyToken: identity.publicKeyToken,
      isRetargetable: identity.isRetargetable, contentType: identity.contentType }, key, sha256: digest });
    this.assemblyIds.set(assembly, index);
    this.keys.set(key, index);
    return index;
  }

  type(symbol, syntax) {
    if (!this.handles(symbol)) this.fail('a type from an assembly outside the supplied SharpForge profile', syntax);
    if (symbol.typeKind !== TypeKind.Class || symbol.arity || symbol.typeArguments?.length
      || symbol.containingType?.arity || symbol.metadataToken >>> 24 !== 2) {
      this.fail('only closed nongeneric class definitions are executable across project boundaries', syntax);
    }
    if (this.typeIds.has(symbol)) return this.data.types[this.typeIds.get(symbol)];
    const index = this.data.types.length;
    if (index >= projectReferenceLimits.types) this.fail('too many referenced project types', syntax);
    const assembly = this.assembly(assemblyOf(symbol), syntax);
    const name = this.name(symbol.metadataFullName, syntax);
    const imageName = this.name('[' + this.data.assemblies[assembly].key + ']' + name, syntax);
    const descriptor = { assembly, token: symbol.metadataToken, name, imageName };
    this.typeIds.set(symbol, index);
    this.data.types.push(descriptor);
    return descriptor;
  }

  method(symbol, syntax) {
    if (this.methodIds.has(symbol)) return { index: this.methodIds.get(symbol), descriptor: this.data.methods[this.methodIds.get(symbol)] };
    if (!this.handles(symbol) || symbol.metadataToken >>> 24 !== 6) this.fail('a method outside a supplied project PE', syntax);
    if (symbol.typeParameters?.length || symbol.typeArguments?.length || symbol.isVararg || symbol.isAbstract
      || symbol.isVirtual || symbol.isOverride || symbol.isExtern || symbol.refKind && symbol.refKind !== 'none'
      || symbol.parameters.some(parameter => parameter.refKind && parameter.refKind !== 'none')) {
      this.fail('generic, virtual, external or by-reference project methods', syntax);
    }
    if (symbol.parameters.length > 1024) this.fail('too many parameters on a project method', syntax);
    const type = ownerOf(symbol);
    this.type(type, syntax);
    const descriptor = { type: this.typeIds.get(type), token: symbol.metadataToken,
      name: this.name(symbol.metadataName, syntax), isStatic: !!symbol.isStatic,
      parameters: symbol.parameters.map(parameter => this.generator.types.imageType(parameter.type, syntax)),
      returnType: this.generator.types.imageType(symbol.returnType, syntax) };
    const index = this.data.methods.length;
    if (index >= projectReferenceLimits.methods) this.fail('too many referenced project methods', syntax);
    this.data.methods.push(descriptor);
    this.methodIds.set(symbol, index);
    return { index, descriptor };
  }

  field(symbol, syntax) {
    if (this.fieldIds.has(symbol)) return { index: this.fieldIds.get(symbol), descriptor: this.data.fields[this.fieldIds.get(symbol)] };
    if (!this.handles(symbol) || symbol.metadataToken >>> 24 !== 4 || symbol.isVolatile || symbol.refKind && symbol.refKind !== 'none') {
      this.fail('a field outside the supported project PE profile', syntax);
    }
    const type = ownerOf(symbol);
    this.type(type, syntax);
    const descriptor = { type: this.typeIds.get(type), token: symbol.metadataToken,
      name: this.name(symbol.metadataName, syntax), isStatic: !!symbol.isStatic,
      fieldType: this.generator.types.imageType(symbol.type, syntax) };
    const index = this.data.fields.length;
    if (index >= projectReferenceLimits.fields) this.fail('too many referenced project fields', syntax);
    this.data.fields.push(descriptor);
    this.fieldIds.set(symbol, index);
    return { index, descriptor };
  }

  snapshot() {
    if (!this.data.assemblies.length) return undefined;
    return this.data;
  }
}
