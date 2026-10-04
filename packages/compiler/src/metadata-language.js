import { parseCompilerInput } from './parse-input.js';
import { SemanticAnalysis } from './semantic-analysis.js';
import { frameworkBridge } from './symbols/registry-bridge.js';
import { SymbolKind } from './symbols/types.js';
import { isAccessible } from './binder/accessibility.js';
import { readCompilationReferences } from './metadata-import/reference-input.js';
import { createRuntimeProfileResolver } from './metadata-import/runtime-profile.js';
import { indexMetadataLanguageBindings, metadataLanguageSymbol } from './metadata-language-index.js';

/** Metadata-backed C# language queries. Assemblies are decoded once; update() invalidates source binding. */
export class MetadataLanguageModel {
  constructor(input, options = {}) {
    const references = options.references ?? [];
    if (!Array.isArray(references) || references.length > 512) throw new RangeError('Metadata language reference count limit exceeded');
    let bytes = 0;
    for (const reference of references) {
      bytes += reference.bytes?.byteLength ?? 0;
      if (bytes > 67108864) throw new RangeError('Metadata language reference byte limit exceeded');
    }
    this.bridge = frameworkBridge();
    const imported = readCompilationReferences(references, { runtimeProfileResolver: createRuntimeProfileResolver(this.bridge) });
    this.references = imported.references;
    this.referenceDiagnostics = imported.diagnostics;
    this.update(input, options);
  }

  /** Replace source/options while retaining immutable decoded references; use a new model when references change. */
  update(input, options = {}) {
    options.signal?.throwIfAborted();
    if (!Array.isArray(input) || input.length > 10000) throw new RangeError('Metadata language source count limit exceeded');
    let characters = 0;
    for (const file of input) {
      if (typeof file?.text !== 'string' || typeof file.uri !== 'string') throw new TypeError('Metadata language sources require uri and text');
      characters += file.text.length;
      if (characters > 4000000) throw new RangeError('Metadata language source character limit exceeded');
    }
    this.options = { ...options, references: this.references, bridge: this.bridge };
    const parseKey = JSON.stringify([options.langVersion, options.langVersionByUri, options.preprocessorSymbols, options.implicitUsings]);
    const previous = this.parseKey === parseKey ? new Map(this.files.map(file => [file.source.uri, file])) : new Map();
    this.files = parseCompilerInput(input.map(file => {
      const cached = previous.get(file.uri);
      return cached?.source.text === file.text && cached.source.version === file.version ? cached : file;
    }), this.options);
    this.parseKey = parseKey;
    this.analysis = new SemanticAnalysis(this.files, this.options);
    this.declarations = this.analysis.runUsings();
    this.binding = null;
    this.bindingIndex = null;
    return this;
  }

  scope(uri, position = 0) {
    let scope = this.analysis.assembly.unitScopes.get(uri);
    let smallest = Infinity;
    for (const type of this.analysis.assembly.types) {
      for (const declaration of type.declarations) {
        const span = declaration.syntax.span;
        if (declaration.uri === uri && span.start <= position && position <= span.end && span.end - span.start < smallest) {
          scope = type.scopeFor(declaration);
          smallest = span.end - span.start;
        }
      }
    }
    return scope;
  }

  resolve(uri, name, position) {
    const scope = this.scope(uri, position);
    if (!scope || typeof name !== 'string' || name.length > 1024) return null;
    const global = name.startsWith('global::');
    const parts = name.replace(/^global::/, '').split('.');
    if (parts.some(part => !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(part))) return null;
    let symbol = global ? this.analysis.globalNamespace : this.analysis.typeBinder.lookup(parts.shift(), 0, scope);
    for (const part of parts) {
      if (!symbol || symbol.ambiguous) return null;
      symbol = symbol.getNamespace?.(part) ?? symbol.getTypeMembers?.(part, 0)[0] ?? null;
    }
    return symbol?.ambiguous ? null : symbol;
  }

  resolveType(uri, name, position = 0) {
    const symbol = this.resolve(uri, name, position);
    return symbol?.kind === SymbolKind.NamedType ? metadataLanguageSymbol(symbol) : null;
  }

  accessible(symbol, scope) {
    return isAccessible(symbol, scope?.containingType, { withinModule: this.analysis.assembly.module,
      assemblyName: this.options.name });
  }

  /** Accessible static or instance members; null means the receiver could not be resolved. */
  members(uri, receiver, { position = 0, receiverStart = position, prefix = '' } = {}) {
    let type = this.resolve(uri, receiver, position);
    const staticAccess = type?.kind === SymbolKind.NamedType;
    if (!staticAccess) type = this.boundAt(uri, receiverStart)?.valueType;
    if (!type?.getMembers) return null;
    const scope = this.scope(uri, position);
    const result = [];
    const seen = new Set();
    for (let depth = 0; type && depth < 64 && !seen.has(type); type = type.baseType, depth++) {
      seen.add(type);
      for (const member of type.getMembers()) {
        if (member.isImplicitlyDeclared || member.name.startsWith('.') || Boolean(member.isStatic) !== staticAccess) continue;
        if (!member.name.toLowerCase().startsWith(prefix.toLowerCase()) || !this.accessible(member, scope)) continue;
        const symbol = metadataLanguageSymbol(member);
        result.push({ label: symbol.name, kind: symbol.kind, detail: symbol.fullName, insertText: symbol.name, symbol });
        if (result.length >= 256) return result;
      }
    }
    return result;
  }

  /** Types visible through lexical and global using scopes; result count is bounded to 256. */
  types(uri, prefix = '', position = 0) {
    const scope = this.scope(uri, position);
    const namespaces = new Set();
    for (let current = scope; current; current = current.parent) {
      if (current.namespace) namespaces.add(current.namespace);
      if (['unit', 'namespace'].includes(current.kind)) {
        for (const namespace of this.analysis.typeBinder.usingsOf(current)?.namespaces ?? []) namespaces.add(namespace);
      }
    }
    const result = [];
    for (const namespace of namespaces) {
      for (const type of namespace.getTypeMembers()) {
        if (!type.name.toLowerCase().startsWith(prefix.toLowerCase()) || !this.accessible(type, scope)) continue;
        const symbol = metadataLanguageSymbol(type);
        result.push({ label: symbol.name, kind: 'class', detail: symbol.fullName, insertText: symbol.name, symbol });
        if (result.length >= 256) return result;
      }
    }
    return result;
  }

  /** Full semantic binding is independent of executable lowering; unsupported execution does not invalidate symbols. */
  analyze() {
    if (!this.binding) {
      const analysis = new SemanticAnalysis(this.files, this.options);
      this.binding = analysis.run();
      this.bindingIndex = indexMetadataLanguageBindings(analysis, this.binding, this.options);
    }
    const diagnostics = [...this.files.flatMap(file => file.diagnostics ?? []), ...this.binding.diagnostics];
    for (const diagnostic of this.referenceDiagnostics) diagnostics.push({ ...diagnostic, severity: 'error',
      message: diagnostic.args.join(': '), uri: this.files[0]?.source.uri, start: 0, length: 0 });
    return { diagnostics, complete: !this.binding.incomplete && !this.binding.unsupported };
  }

  boundAt(uri, position) {
    this.analyze();
    let selected = null;
    for (const entry of this.bindingIndex) {
      if (entry.uri !== uri || entry.start > position || entry.end < position) continue;
      if (!selected || entry.end - entry.start < selected.end - selected.start) selected = entry;
    }
    return selected;
  }

  symbolAt(uri, position) {
    const entry = this.boundAt(uri, position);
    return entry ? metadataLanguageSymbol(entry.symbol, { uri, start: entry.start, end: entry.end }) : null;
  }
}
