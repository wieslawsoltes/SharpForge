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
import { CustomAttributeWriter } from '../../codegen/metadata/custom-attributes.js';
import { MemberTokens } from './member-tokens.js';
import { MethodEmitter } from './method-emitter.js';
import { SynthesizedMembers, isEntryPointMethod } from './synthesized-members.js';
import { UnsupportedInCil } from './unsupported.js';

const CLI_HEADER_SIZE = 72;
const initializedKinds = new Set([SymbolKind.Field, SymbolKind.Property, SymbolKind.Event]);

export class AssemblyEmitter {
  /**
   * @param analysis a SemanticAnalysis that has run without errors
   * @param {{name?: string, framework?: string, deterministic?: boolean, outputKind?: string}} [options]
   */
  constructor(analysis, options = {}) {
    this.analysis = analysis;
    this.options = options;
    this.core = analysis.core;
    this.bodyAddresses = new Map();
  }
  /** @returns {{bytes: Uint8Array, entryPoint: number}} the image and the token of its entry point (0 for a library) */
  emit() {
    const options = this.options,
      builder = new MetadataBuilder(options.name ?? 'Application', { framework: options.framework ?? 'net8' }),
      section = new Writer().zero(CLI_HEADER_SIZE),
      synthesized = new SynthesizedMembers(this.analysis),
      writer = new SymbolMetadataWriter(builder, this.analysis, { bodyRva: method => this.bodyAddresses.get(method), synthesized });
    writer.allocateTokens();
    this.tokens = new MemberTokens(writer);
    /** Every type the assembly defines, for questions that need the whole program (who derives from a class). */
    this.sourceTypes = writer.types;
    this.closures = synthesized.closures;
    this.stateMachines = synthesized.stateMachines;
    this.primaryCaptures = synthesized.primaryCaptures.byParameter;
    // A state machine class gets fields while its `MoveNext` is emitted, which moves the field tokens of the classes
    // after it: those bodies come first, class by class, and nothing emitted before names a later class's fields.
    const lateFieldTypes = new Set(synthesized.stateMachines.lateFieldTypes);
    for (const type of lateFieldTypes) {
      this.emitBodies(type, writer, section);
      writer.allocateTokens();
    }
    for (const type of writer.types) if (!lateFieldTypes.has(type)) this.emitBodies(type, writer, section);
    writer.write();
    new CustomAttributeWriter(writer, this.analysis).write();
    const isLibrary = options.outputKind === 'library',
      entryPoint = isLibrary ? 0 : this.entryPointToken(writer, synthesized);
    section.pad();
    const metadataOffset = section.length,
      metadata = builder.finish(null, section.finish());
    section.bytes(metadata);
    const peOptions = { outputKind: isLibrary ? 'library' : 'console', deterministic: options.deterministic ?? true },
      bytes = writePE(section.finish(), metadataOffset, metadata.length, entryPoint, peOptions);
    return { bytes, entryPoint };
  }
  /** Emits the bodies of one type into the text section and records where each begins. */
  emitBodies(type, writer, section) {
    for (const method of writer.plans.get(type).methods) {
      if (!method.hasBody) continue;
      const il = this.methodBody(type, method),
        body = il.assemble();
      section.pad();
      this.bodyAddresses.set(method, TEXT_RVA + section.length);
      section.bytes(writeMethodBody(body.code, this.tokens.locals(il.locals), body.maxStack, body.handlers));
    }
  }
  /** The instruction stream of one planned method. */
  methodBody(type, planned) {
    const program = this,
      symbol = planned.symbol;
    if (!symbol) {
      if (!planned.emitBody) throw new UnsupportedInCil(`the synthesized member '${type.name}.${planned.name}'`, type.locations?.[0]);
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
    if (machine) {
      if (isEntryPointMethod(symbol)) emitter.moduleInitializers();
      return emitter.kickoffBody(machine);
    }
    if (bound?.binder?.c?.isIterator) emitter.unsupported('iterator methods', symbol.locations?.[0]);
    if (symbol.isAsync) emitter.unsupported('async methods', symbol.locations?.[0]);
    if (symbol.methodKind === MethodKind.Constructor) return emitter.body(bound, () => emitter.constructorPrologue(symbol));
    if (symbol.methodKind === MethodKind.StaticConstructor) return emitter.body(bound, () => emitter.staticInitializers(type));
    if (bound) return emitter.body(bound, isEntryPointMethod(symbol) ? () => emitter.moduleInitializers() : null);
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
    if (synthesized.entryPoint) return synthesized.entryPoint.token;
    // A `Main` that returns a task is the entry point only when no other `Main` is; `<Main>` then waits for it.
    const all = [...writer.methodTokens].filter(([method]) => isEntryPointMethod(method)),
      synchronous = all.filter(([method]) => !synthesized.asyncEntryPoints.has(method)),
      candidates = synchronous.length ? synchronous : all;
    if (candidates.length !== 1) {
      throw new UnsupportedInCil(candidates.length ? 'several Main methods' : 'a program without an entry point');
    }
    const [method, token] = candidates[0];
    return synthesized.asyncEntryPoints.get(method)?.token ?? token;
  }
}

/**
 * Emits the assembly of an analysed compilation.
 * @returns {{bytes: Uint8Array, entryPoint: number}}
 * @throws {UnsupportedInCil} for a construct the emitter has no code for
 */
export function emitAssemblyFromAnalysis(analysis, options = {}) {
  return new AssemblyEmitter(analysis, options).emit();
}
