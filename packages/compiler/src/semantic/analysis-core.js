/**
 * The state of one semantic analysis: files, options, core types, resolvers, the diagnostics sink and the
 * policies for the parts of the framework the closed registry does not model.
 */
import { diagnostic } from '@sharpforge/text';
import { languageVersion as parseVersion } from '@sharpforge/syntax';
import { TypeKind } from '../symbols/types.js';
import { mergeGlobalNamespaces } from '../symbols/namespaces.js';
import { CoreTypes } from '../symbols/core-types.js';
import { frameworkBridge } from '../symbols/registry-bridge.js';
import { SourceAssembly } from '../symbols/source/syntax-symbols.js';
import { baseTypeChain } from '../symbols/substitution.js';
import { TypeBinder } from '../binder/type-binder.js';
import { Conversions } from '../conversions/classify.js';
import { OverloadResolver } from '../overload/resolution.js';
import { OperatorResolver } from '../overload/operators.js';
import { resolveBases } from '../binder/inheritance.js';
import { createFeatureGate } from '../binder/feature-check.js';
import { formatMessage, defaultSeverity, hasDiagnosticCode } from '../diagnostics/codes.js';
import { NullableContextMap } from '../nullable/annotations.js';
import { bindCompilationReferences } from '../metadata-import/compilation-references.js';
import { spanOf, knownNamespaces, frameworkNames, isSourceSymbol } from './analysis-helpers.js';

export class AnalysisCore {
  /**
   * @param {object[]} files parsed files (`parse()` results with `syntax`, `source`, `directives`)
   * @param {object} [options] compilation options: langVersion, langVersionByUri, nullableContext, name, references (imported global namespaces)
   */
  constructor(files, options = {}) {
    this.files = files.filter(f => f.syntax);
    this.options = options;
    this.diagnostics = [];
    this.incomplete = false;
    this.references = bindCompilationReferences(options.references, options.bridge ?? frameworkBridge());
    this.core = new CoreTypes(this.references.coreLibrary);
    this.sources = new Map(this.files.map(f => [f.source.uri, f.source]));
    const latest = this.versionOf(this.files[0]?.source.uri).number;
    this.conversions = new Conversions(this.core, { numericIntPtr: latest >= 11, firstClassSpans: latest >= 14 });
    this.overloads = new OverloadResolver(this.conversions, this.core);
    this.operators = new OperatorResolver(this.conversions, this.core, this.overloads);
    this.constructions = [];
    this.nullableMaps = new Map();
    this.bound = new Map();
    this.constantState = new Map();
    this.unexecutable = new Map();
    this.typeBinder = new TypeBinder({
      core: this.core,
      report: (uri, node, code, args) => this.report(uri, node, code, args),
      constructions: this.constructions,
      tolerateNamespace: name => this.tolerateNamespace(name),
      useSite: (symbol, uri, node) => {
        for (const d of this.references.useSiteDiagnostics(symbol)) this.report(uri, node, d.code, d.args);
      },
      isKnownFrameworkName: name => this.isKnownFrameworkName(name),
      get module() {
        return self.assembly.module;
      },
      nullableAnnotationsAt: (uri, position) => this.nullableAt(uri, position).annotations,
      get globalNamespace() {
        return self.globalNamespace;
      },
    });
    const self = this;
    this.gate = createFeatureGate(
      uri => this.versionOf(uri),
      (uri, node, code, message) => this.push(uri, node, code, message, 'error'),
    );
    this.assembly = new SourceAssembly(this.files, {
      core: this.core,
      typeBinder: this.typeBinder,
      name: options.name,
      report: (uri, node, code, args) => this.report(uri, node, code, args),
      resolveBases: type =>
        resolveBases(type, {
          typeBinder: this.typeBinder,
          core: this.core,
          report: (uri, node, code, args) => this.report(uri, node, code, args),
        }),
    });
    this.globalNamespace = mergeGlobalNamespaces(this.assembly.globalNamespace, ...this.references.globalNamespaces);
    for (const d of this.references.diagnostics) this.report(this.files[0]?.source.uri, { start: 0, end: 0 }, d.code, d.args);
  }
  versionOf(uri) {
    try {
      return parseVersion(this.options.langVersionByUri?.[uri] ?? this.options.langVersion ?? 'default');
    } catch {
      return parseVersion('default');
    }
  }
  nullableAt(uri, position) {
    let map = this.nullableMaps.get(uri);
    if (!map) {
      map = new NullableContextMap(
        this.files.find(f => f.source.uri === uri)?.directives ?? [],
        this.options.nullableContext ?? this.options.nullable ?? 'disable',
      );
      this.nullableMaps.set(uri, map);
    }
    return map.stateAt(position);
  }
  /** Namespaces of the BCL the closed registry does not model are accepted in using directives and qualified names. */
  tolerateNamespace(name) {
    if (this.references.hasCoreLibrary) return false;
    if (knownNamespaces.test(name)) {
      this.incomplete = true;
      this.hasUnknownUsings = true;
      return true;
    }
    return false;
  }
  /** Names of common BCL types the registry does not model: using one is not an error, it only makes the analysis incomplete. */
  isKnownFrameworkName(name) {
    if (this.references.hasCoreLibrary) return false;
    if (frameworkNames.has(name)) {
      this.incomplete = true;
      return true;
    }
    return false;
  }
  /** True when every base class of `type` is declared in source (or is one of the fully modelled roots), so a missing member really is missing. */
  closedHierarchy(type) {
    if (this.hasUnknownUsings) return false;
    if (type.typeKind === TypeKind.TypeParameter)
      return !type.hasUnknownConstraint && [...type.constraintTypes].every(c => this.closedHierarchy(c));
    if (type.typeKind === TypeKind.Delegate || type.elementType) return false;
    for (const t of baseTypeChain(type, this.core)) {
      if (isSourceSymbol(t)) continue;
      if (['System_Object', 'System_ValueType', 'System_Enum'].includes(t.specialType)) continue;
      return false;
    }
    return type.typeKind !== TypeKind.Interface || (isSourceSymbol(type) && type.allInterfaces.every(i => isSourceSymbol(i)));
  }
  /** The registry lists a subset of each framework type's members, so a missing member proves nothing. */
  registryIsComplete() {
    return false;
  }
  isError(code) {
    return defaultSeverity(code) === 'error';
  }
  report(uri, node, code, args = [], severity) {
    if (!hasDiagnosticCode(code)) {
      this.incomplete = true;
      return;
    }
    this.push(uri, node, code, formatMessage(code, args), severity ?? defaultSeverity(code));
  }
  push(uri, node, code, message, severity) {
    const source = this.sources.get(uri) ?? this.files[0]?.source;
    if (!source || this.diagnostics.length >= 400) return;
    const s = spanOf(node),
      start = s.start ?? 0,
      length = Math.max(code === 'CS0162' || s.end > start ? (s.end ?? start) - start : 1, s.end === start ? 0 : 1);
    if (this.diagnostics.some(d => d.code === code && d.uri === source.uri && d.start === start && d.message === message)) return;
    this.diagnostics.push(diagnostic(source, start, length || 1, code, message, severity));
  }
  /** Runs every phase and returns `{diagnostics,incomplete,assembly,bound,unexecutable}`. */
  run() {
    this.assembly.declare(this.globalNamespace);
    // `record` declarations are not parsed yet (they arrive as a method named after the record): nothing can be said about such a file.
    if (this.assembly.topLevel.some(i => i.statement?.kind === 'LocalFunctionStatement' && i.statement.returnType?.toString() === 'record'))
      return {
        diagnostics: [],
        incomplete: true,
        unsupported: true,
        assembly: this.assembly,
        bound: this.bound,
        core: this.core,
        unexecutable: this.unexecutable,
      };
    const types = this.assembly.types;
    for (const type of types) type.baseType;
    for (const type of types) type.getMembers();
    for (const type of types) this.bindExplicitInterfaces(type);
    for (const type of types) this.checkType(type);
    this.checkConstructions();
    for (const type of types) this.bindConstants(type);
    this.bindBodies();
    this.reportUnused();
    return {
      diagnostics: this.diagnostics,
      incomplete: this.incomplete,
      assembly: this.assembly,
      bound: this.bound,
      core: this.core,
      unexecutable: this.unexecutable,
    };
  }
  at(symbol) {
    return symbol.locations?.[0] ?? this.assembly.types[0]?.locations[0];
  }
  reportAt(symbol, code, args, severity) {
    const at = this.at(symbol);
    if (at) this.report(at.uri, at, code, args, severity);
  }
}
