/**
 * CIL emission from bound trees (SF-A02-T30): an analysed compilation written as an ECMA-335 assembly whose method
 * bodies are generated from the semantic bound trees - not from the bytecode image, so what the image cannot express
 * (base types, virtual calls, type tests, value types, by-references) reaches the assembly.
 *
 *   metadata   codegen/metadata/symbol-metadata.js (one row per symbol) plus synthesized-members.js
 *   bodies     method-emitter.js, one instruction stream per method with a body
 *   image      `writeMethodBody` and `writePE` of `@sharpforge/cil`
 *
 * Definition tokens are allocated before the first body is emitted, bodies are laid out in the text section, and the
 * metadata rows are written last, when every method knows the address of its body.
 */
import { MetadataBuilder, Writer, writeMethodBody, writePE, TEXT_RVA } from '@sharpforge/cil';
import { SymbolKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { SymbolMetadataWriter } from '../../codegen/metadata/symbol-metadata.js';
import { installCompilerAttributeBodies } from './compiler-attribute-bodies.js';
import { CustomAttributeWriter } from '../../codegen/metadata/custom-attributes.js';
import { referenceIdentitiesOf } from '../../codegen/metadata/reference-identities.js';
import { MemberTokens } from './member-tokens.js';
import { MethodEmitter } from './method-emitter.js';
import { SynthesizedMembers, isEntryPointMethod } from './synthesized-members.js';
import { UnsupportedInCil } from './unsupported.js';
import { nameThroughInstantiations, synthesizedMembersByToken } from './instantiated-members.js';
import { createCilDebugInformation } from './debug-information.js';

const CLI_HEADER_SIZE = 72;
const initializedKinds = new Set([SymbolKind.Field, SymbolKind.Property, SymbolKind.Event]);

export class AssemblyEmitter {
  /**
   * @param analysis a SemanticAnalysis that has run without errors
   * @param {{name?: string, framework?: string, deterministic?: boolean, outputKind?: string, portablePdb?: boolean,
   *   embeddedPdb?: boolean, embedSources?: boolean, sourceLink?: {documents: Object<string, string>}}} [options]
   */
  constructor(analysis, options = {}) {
    this.analysis = analysis;
    this.options = options;
    this.core = analysis.core;
    this.bodyAddresses = new Map();
    this.debugInformation = createCilDebugInformation(analysis, options);
  }
  /** @returns {{bytes: Uint8Array, entryPoint: number, pdb: Uint8Array|null}} the image, entry point, and optional symbols */
  emit() {
    const options = this.options,
      // With reference assemblies every AssemblyRef carries the identity of the assembly the type was read from.
      assemblyReferences = referenceIdentitiesOf(this.analysis),
      builder = new MetadataBuilder(options.name ?? 'Application', { framework: options.framework ?? 'net8', assemblyReferences }),
      section = new Writer().zero(CLI_HEADER_SIZE),
      synthesized = new SynthesizedMembers(this.analysis),
      writer = new SymbolMetadataWriter(builder, this.analysis, { bodyRva: method => this.bodyAddresses.get(method), synthesized });
    writer.allocateTokens();
    installCompilerAttributeBodies(writer);
    this.tokens = new MemberTokens(writer);
    /** The synthesized members by definition token; rebuilt when tokens move or a field is added. */
    this.synthesizedIndex = { byToken: null };
    /** Every type the assembly defines, for questions that need the whole program (who derives from a class). */
    this.sourceTypes = writer.types;
    this.closures = synthesized.closures;
    this.dynamicSites = synthesized.dynamicSites;
    this.stateMachines = synthesized.stateMachines;
    this.primaryCaptures = synthesized.primaryCaptures.byParameter;
    this.records = synthesized.records;
    this.fixedBuffers = synthesized.fixedBuffers.byField;
    this.utf8Literals = synthesized.utf8Literals;
    // A state machine class gets fields while its `MoveNext` is emitted, which moves the field tokens of the classes
    // after it (`emitBodies` allocates again): those bodies come first, class by class, and nothing emitted before
    // names a later class's fields.
    const lateFieldTypes = new Set(synthesized.stateMachines.lateFieldTypes);
    for (const method of writer.moduleMethods) this.emitBody(null, method, writer, section);
    for (const type of lateFieldTypes) this.emitBodies(type, writer, section);
    for (const type of writer.types) if (!lateFieldTypes.has(type)) this.emitBodies(type, writer, section);
    writer.write();
    synthesized.utf8Literals.writeRvas(writer, section);
    new CustomAttributeWriter(writer, this.analysis).write();
    const isLibrary = options.outputKind === 'library',
      entryPoint = isLibrary ? 0 : this.entryPointToken(writer, synthesized);
    section.pad();
    const metadataOffset = section.length,
      metadata = builder.finish(null, section.finish());
    section.bytes(metadata);
    const peOptions = { outputKind: isLibrary ? 'library' : 'console', deterministic: options.deterministic ?? true },
      bytes = writePE(section.finish(), metadataOffset, metadata.length, entryPoint, peOptions);
    return this.debugInformation?.finish({ bytes, entryPoint }) ?? { bytes, entryPoint, pdb: null };
  }
  /** Emits the bodies of one type into the text section and records where each begins. */
  emitBodies(type, writer, section) {
    for (const method of writer.plans.get(type).methods) if (method.hasBody) this.emitBody(type, method, writer, section);
  }
  /** Emits one body; `type` is null for a method of `<Module>`. */
  emitBody(type, method, writer, section) {
    // The code of a synthesized generic class or method reads the type parameters it was written over as its own.
    const program = this.within(method.substitution ?? type?.typeSubstitution ?? null),
      il = program.methodBody(type, method);
    if (!this.synthesizedIndex.byToken) {
      // A field added while the body was emitted took the next token of its class: the classes after it move up.
      writer.allocateTokens();
      this.synthesizedIndex.byToken = synthesizedMembersByToken(writer);
    }
    nameThroughInstantiations(il, program.tokens, this.synthesizedIndex.byToken);
    const body = il.assemble();
    this.debugInformation?.record(method, il, body);
    section.pad();
    this.bodyAddresses.set(method, TEXT_RVA + section.length);
    section.bytes(writeMethodBody(body.code, program.tokens.locals(il.locals), body.maxStack, body.handlers));
  }
  /** This emitter with tokens that read every type under a substitution (generic-context.js); itself for none. */
  within(substitution) {
    if (!substitution) return this;
    const view = Object.create(this);
    view.tokens = this.tokens.within(substitution);
    return view;
  }
  /** The instruction stream of one planned method. */
  methodBody(type, planned) {
    const program = this,
      symbol = planned.symbol;
    if (planned.emitBody) return planned.emitBody(program);
    if (!symbol) {
      if (!planned.emitBody) throw new UnsupportedInCil(`the synthesized member '${type?.name}.${planned.name}'`, type?.locations?.[0]);
      return planned.emitBody(program);
    }
    const bound = this.analysis.bound.get(symbol) ?? null,
      emitter = new MethodEmitter(program, {
        uri: this.uriOf(symbol),
        containingType: type,
        isStatic: symbol.isStatic,
        parameters: symbol.parameters,
        returnType: symbol.returnType,
        method: symbol,
      });
    const machine = this.stateMachines.of(symbol);
    if (machine) return emitter.kickoffBody(machine);
    if (bound?.binder?.c?.isIterator) emitter.unsupported('iterator methods', symbol.locations?.[0]);
    if (symbol.isAsync) emitter.unsupported('async methods', symbol.locations?.[0]);
    if (symbol.methodKind === MethodKind.Constructor) return emitter.body(bound, () => emitter.constructorPrologue(symbol));
    if (symbol.methodKind === MethodKind.StaticConstructor) return emitter.body(bound, () => emitter.staticInitializers(type));
    if (symbol.methodKind === MethodKind.Destructor && bound) return emitter.destructorBody(bound, type);
    if (bound) return emitter.body(bound);
    return emitter.synthesizedBody(symbol) ?? emitter.unsupported(`'${symbol.toDisplayString()}' (no body)`, symbol.locations?.[0]);
  }
  uriOf(symbol) {
    return symbol.uri ?? symbol.locations?.[0]?.uri ?? null;
  }
  /**
   * The initialized fields of a type with their bound initializers, in declaration order.
   * @returns {{field: object, bound: object}[]} `field` is the field symbol the value is stored in
   */
  initializersOf(type, isStatic) {
    const list = [];
    for (const member of type.getMembers()) {
      if (!initializedKinds.has(member.kind) || !!member.isStatic !== isStatic || member.isConst) continue;
      const bound = this.analysis.bound.get(member);
      if (!bound) continue;
      const field = member.kind === SymbolKind.Field ? member : member.backingField;
      if (!field) throw new UnsupportedInCil(`the initializer of '${member.toDisplayString()}'`, bound.syntax, this.uriOf(member));
      list.push({ field, bound });
    }
    return list;
  }
  /** The entry point: the top-level statements, else the single static `Main`. */
  entryPointToken(writer, synthesized) {
    if (synthesized.entryPoint) {
      this.debugInformation?.entryPoint(synthesized.topLevel.body);
      return synthesized.entryPoint.token;
    }
    // A `Main` that returns a task is the entry point only when no other `Main` is; `<Main>` then waits for it.
    const all = [...writer.methodTokens].filter(([method]) => isEntryPointMethod(method)),
      synchronous = all.filter(([method]) => !synthesized.asyncEntryPoints.has(method)),
      candidates = synchronous.length ? synchronous : all;
    if (candidates.length !== 1) {
      throw new UnsupportedInCil(candidates.length ? 'several Main methods' : 'a program without an entry point');
    }
    const [method, token] = candidates[0];
    this.debugInformation?.entryPoint(method);
    return synthesized.asyncEntryPoints.get(method)?.token ?? token;
  }
}

/**
 * Emits the assembly of an analysed compilation.
 * @returns {{bytes: Uint8Array, entryPoint: number, pdb: Uint8Array|null}}
 * @throws {UnsupportedInCil} for a construct the emitter has no code for
 */
export function emitAssemblyFromAnalysis(analysis, options = {}) {
  return new AssemblyEmitter(analysis, options).emit();
}
