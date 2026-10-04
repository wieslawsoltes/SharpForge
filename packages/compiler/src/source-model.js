import {SemanticAnalysis} from './semantic-analysis.js';
import {forEachChild} from './bound/semantic-walker.js';
import {originalSymbol, sourceSymbolRecord, symbolNameToken} from './source-symbols.js';
import {sourceReference} from './source-references.js';
import {argumentHints} from './source-arguments.js';
import {metadataReference} from './source-metadata.js';

/** A revision-local query index over actual lossless-source binding; it never changes or emits program code. */
export class SourceSemanticModel {
  constructor(compilation) {
    const options = {...compilation.options, nullableContext: compilation.typedOptions?.nullableContext ??
      compilation.options.nullableContext};
    this.analysis = compilation.sourceAnalysisComplete ? compilation.sourceAnalysis :
      new SemanticAnalysis(compilation.inputFiles, options);
    this.result = compilation.sourceAnalysisComplete ? compilation.sourceAnalysisResult : this.analysis.run();
    this.sources = this.analysis.sources;
    this.symbols = [];
    this.references = [];
    this.hints = [];
    this.metadata = [];
    this.records = new Map();
    this.symbolsById = new Map();
    this.symbolsByUri = new Map();
    this.referencesByUri = new Map();
    this.documentSymbolCache = new Map();
    this.referenceKeys = new Map();
    this.declareTypes();
    this.indexBodies();
    for (const use of this.analysis.symbolUses ?? []) this.addReference(use.symbol, use.uri, use.node);
    this.references.sort((a, b) => a.uri.localeCompare(b.uri) || a.start - b.start || a.end - b.end);
    for (const reference of this.references) {
      if (!this.referencesByUri.has(reference.uri)) this.referencesByUri.set(reference.uri, []);
      this.referencesByUri.get(reference.uri).push(reference);
    }
    this.indexDocumentSymbols();
  }

  record(symbol, uri) {
    symbol = originalSymbol(symbol);
    if (!symbol) return null;
    if (this.records.has(symbol)) return this.records.get(symbol);
    const record = sourceSymbolRecord(symbol, uri);
    this.records.set(symbol, record);
    if (record) {
      this.symbolsById.set(record.id, symbol);
      this.symbols.push(record);
      if (!this.symbolsByUri.has(record.uri)) this.symbolsByUri.set(record.uri, []);
      this.symbolsByUri.get(record.uri).push(record);
    }
    return record;
  }

  declare(symbol, uri) {
    symbol = originalSymbol(symbol);
    const record = this.record(symbol, uri);
    if (!record) return;
    const declarations = symbol.declarations ?? [{uri: record.uri, syntax: symbol.syntax}];
    for (const declaration of declarations) {
      const target = declaration.uri ?? record.uri;
      this.addReference(symbol, target, declaration.syntax, true);
    }
    for (const parameter of symbol.parameters ?? []) this.declare(parameter, record.uri);
  }

  declareTypes() {
    for (const type of this.analysis.assembly.types) {
      this.declare(type);
      for (const member of type.getMembers()) {
        if (member.kind === 'NamedType') continue;
        if (member.isConstructor || member.methodKind === 'destructor') {
          this.addReference(type, member.uri ?? member.locations?.[0]?.uri, member.syntax, true);
        } else this.declare(member);
      }
    }
  }

  addReference(symbol, uri, syntax, declaration = false) {
    symbol = originalSymbol(symbol);
    if (symbol?.isConstructor) symbol = originalSymbol(symbol.containingType);
    const record = this.record(symbol, uri);
    if (!record) return;
    const reference = sourceReference(record, uri, syntax, this.sources.get(uri), declaration);
    if (!reference) return;
    const key = `${record.id}:${uri}:${reference.start}:${reference.end}`;
    const previous = this.referenceKeys.get(key);
    if (previous) {
      if (declaration) Object.assign(previous, reference);
      else if (!previous.declaration) {
        previous.read ||= reference.read;
        previous.write ||= reference.write;
        previous.kind = previous.write ? 'write' : 'read';
      }
    } else {
      this.referenceKeys.set(key, reference);
      this.references.push(reference);
    }
  }

  indexBodies() {
    const seen = new Set();
    const hintKeys = new Set();
    for (const [member, body] of this.analysis.bound) {
      const uri = member.uri ?? member.locations?.[0]?.uri ?? body.binder?.c.uri;
      const source = this.sources.get(uri);
      if (!source) continue;
      for (const local of body.binder?.allLocals ?? body.locals ?? []) this.declare(local, uri);
      for (const entry of body.binder?.allLocalFunctions ?? []) this.declare(entry.method, entry.uri);
      for (const parameter of body.binder?.c.parameters ?? []) this.declare(parameter, uri);
      const stack = [body];
      while (stack.length) {
        const node = stack.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        const symbol = node.local ?? node.parameter ?? node.field ?? node.property ?? node.event ?? node.referencedType;
        if (symbol) this.addReference(symbol, uri, node.syntax);
        if (node.kind === 'Call') this.addReference(node.method, uri, node.syntax);
        if (node.kind === 'ObjectCreation') this.addReference(node.type, uri, node.syntax);
        const external = metadataReference(node, uri, source);
        if (external) this.metadata.push(external);
        for (const hint of argumentHints(node, uri, source)) {
          const key = `${uri}:${hint.offset}:${hint.label}`;
          if (!hintKeys.has(key)) { hintKeys.add(key); this.hints.push(hint); }
        }
        forEachChild(node, child => stack.push(child));
      }
    }
  }

  referenceAt(uri, offset) {
    const items = this.referencesByUri.get(uri) ?? [];
    let low = 0;
    let high = items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (items[middle].start <= offset) low = middle + 1;
      else high = middle;
    }
    const reference = items[low - 1];
    return reference && reference.end >= offset ? reference : null;
  }

  symbolAt(uri, offset) {
    const reference = this.referenceAt(uri, offset);
    return reference ? this.records.get(this.symbolsById.get(reference.symbolId)) : null;
  }

  metadataAt(uri, offset) {
    return this.metadata.find(item => item.uri === uri && item.start <= offset && offset <= item.end) ?? null;
  }

  indexDocumentSymbols() {
    for (const record of this.symbols) {
      if (['local', 'parameter'].includes(record.kind)) continue;
      const symbol = this.symbolsById.get(record.id);
      const declarations = symbol.declarations ?? [{uri: record.uri, syntax: symbol.syntax}];
      for (const declaration of declarations) {
        const uri = declaration.uri ?? record.uri;
        const token = symbolNameToken(declaration.syntax);
        if (!this.documentSymbolCache.has(uri)) this.documentSymbolCache.set(uri, []);
        this.documentSymbolCache.get(uri).push({...record, uri, ...(token?.span ?? {}), version: this.sources.get(uri)?.version});
      }
    }
  }

  documentSymbols(uri) { return this.documentSymbolCache.get(uri) ?? []; }
}
