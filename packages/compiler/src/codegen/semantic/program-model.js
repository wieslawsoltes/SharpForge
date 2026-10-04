import {imageMethod} from '../image-method.js';
/**
 * The program being generated from semantic bound trees: image classes, fields, statics, methods, the constant pool
 * and sequence points. It is the `compilation` the IR emitter writes into, and it serialises to the bytecode image
 * format (the same shape `Compilation.build` produces for the execution profile).
 */
import { FORMAT_VERSION } from '@sharpforge/bytecode';
import { defaultValue } from '../../type-utils.js';

const noSpan = Object.freeze({ start: 0, end: 0 });

export class ProgramModel {
  /** @param {Map<string, object>} sources SourceText per uri  @param {string} name assembly name */
  constructor(sources, name = 'Application') {
    this.sources = sources;
    this.name = name;
    this.types = [];
    this.typesByName = new Map();
    this.methods = [];
    this.statics = [];
    this.constants = [];
    this.constantMap = new Map();
    this.sequencePoints = [];
    this.semantic = {nameOf: type => typeof type === 'string' ? type : type?.toDisplayString() ?? 'System.Exception'};
  }
  /** Interns a constant and returns its pool index (same keying as the execution pipeline). */
  constant(value) {
    const key = JSON.stringify([typeof value, value]);
    let id = this.constantMap.get(key);
    if (id === undefined) {
      id = this.constants.length;
      this.constants.push(value);
      this.constantMap.set(key, id);
    }
    return id;
  }
  /** A name no image class has yet: `name`, or `name` with a numeric suffix. */
  uniqueTypeName(name) {
    if (!this.typesByName.has(name)) return name;
    for (let i = 1; ; i++) if (!this.typesByName.has(name + '#' + i)) return name + '#' + i;
  }
  /** Declares an image class. `node` is `{uri,start,end}` of its declaration (or nothing for synthesized classes). */
  addClass(name, node = null, shape = {}) {
    const record = {
      ...shape,
      id: this.types.length,
      name: this.uniqueTypeName(name),
      fields: [],
      properties: [],
      methods: [],
      interfaces: [],
      node: node ?? noSpan,
      initializer: undefined,
    };
    this.types.push(record);
    this.typesByName.set(record.name, record);
    return record;
  }
  /** Adds an instance field to an image class. */
  addField(owner, name, type, extra = {}) {
    const field = { name, type, index: owner.fields.length, owner, isStatic: false, ...extra };
    owner.fields.push(field);
    return field;
  }
  /** Adds a static field (a slot of the image's statics table) owned by an image class. */
  addStatic(owner, name, type, extra = {}) {
    const field = { name, type, index: this.statics.length, owner, isStatic: true, ...extra };
    this.statics.push(field);
    return field;
  }
  /**
   * Declares a method. `owner` is an image class or null (program-level code).
   * @param {{isStatic:boolean, returnType:string, parameters:{name:string,type:string}[], node?:object, accessor?:object}} signature
   *   optionally `asyncRole` ('kickoff', 'body' or 'capture') and `asyncOrigin` (the source function), which debuggers show
   */
  addMethod(owner, name, signature) {
    const node = signature.node ?? noSpan;
    const method = {
      id: this.methods.length,
      name,
      qualifiedName: (owner ? owner.name + '.' : '') + name,
      owner,
      isStatic: signature.isStatic,
      callingConvention: signature.callingConvention ?? 0,
      objectSlot: signature.objectSlot ?? null,
      isOverride: signature.isOverride,
      ...dispatchShape(signature),
      returnType: signature.returnType,
      parameters: signature.parameters.map(p => ({ start: node.start, end: node.end, ...p })),
      node,
      hasSource: !!signature.hasSource,
      accessor: signature.accessor ?? null,
      asyncRole: signature.asyncRole ?? null,
      asyncOrigin: signature.asyncOrigin ?? null,
      locals: [],
      code: new Int32Array(),
      handlers: [],
    };
    this.methods.push(method);
    owner?.methods.push(method);
    return method;
  }
  /** The bytecode image. `files` are the parsed source files; `entryPoint` is a method id. */
  toImage(files, entryPoint) {
    return {
      formatVersion: FORMAT_VERSION,
      name: this.name,
      entryPoint,
      constants: this.constants,
      sequencePoints: this.sequencePoints,
      sources: files.map(f => ({ uri: f.source.uri, text: f.source.text, version: f.source.version })),
      types: this.types.map(t => ({
        ...(t.valueType ? {valueType: true, base: t.base} : {}),
        ...(t.interface ? {interface: true, abstract: true} : {}),
        ...(t.interfaces.length ? {interfaces: t.interfaces} : {}),
        ...(t.sourceIdentity ? {sourceIdentity: t.sourceIdentity} : {}),
        id: t.id,
        name: t.name,
        fields: t.fields.map(f => ({ name: f.name, type: f.type, index: f.index, ...(f.backing ? { backing: true } : {}) })),
        initializer: t.initializer,
      })),
      statics: this.statics.map(f => ({ name: `${f.owner.name}.${f.name}`, type: f.type, value: defaultValue(f.type) })),
      methods: this.methods.map(method => ({
        ...imageMethod(method),
        ...dispatchShape(method),
        ...(method.callingConvention ? {callingConvention: method.callingConvention} : {}),
        ...(method.objectSlot ? {objectSlot: method.objectSlot} : {}),
      })),
    };
  }
}

function dispatchShape(method) {
  return Object.fromEntries(['isVirtual', 'isAbstract', 'isFinal', 'isNewSlot', 'access', 'explicitInterfaceImplementations']
    .filter(key => method[key] !== undefined).map(key => [key, method[key]]));
}
