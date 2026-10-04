/**
 * The state of one semantic analysis: files, options, core types, resolvers, the diagnostics sink and the
 * policies for the parts of the framework the closed registry does not model.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { diagnostic } from '@sharpforge/text';
import { languageVersion as parseVersion } from '@sharpforge/syntax';
import { TypeKind } from '../symbols/types.js';
import { mergeGlobalNamespaces } from '../symbols/namespaces.js';
import { CoreTypes } from '../symbols/core-types.js';
import { frameworkBridge } from '../symbols/registry-bridge.js';
import { SourceAssembly } from '../symbols/source/syntax-symbols.js';
import { baseTypeChain } from '../symbols/substitution.js';
import { TypeBinder } from '../binder/type-binder.js';
import { UnionConversions as Conversions } from '../conversions/unions.js';
import { OverloadResolver } from '../overload/resolution.js';
import { OperatorResolver } from '../overload/operators.js';
import { resolveBases } from '../binder/inheritance.js';
import { checkConstructedMethod } from '../binder/constraints.js';
import { createFeatureGate } from '../binder/feature-check.js';
import { formatMessage, defaultSeverity, hasDiagnosticCode } from '../diagnostics/codes.js';
import { NullableContextMap } from '../nullable/annotations.js';
import { bindCompilationReferences } from '../metadata-import/compilation-references.js';
import { spanOf, frameworkNames, isSourceSymbol } from './analysis-helpers.js';
import { definedSymbols } from '../binder/csharp2-misc.js';
import { isBclNamespace } from '../symbols/bcl-namespaces.js';
import { bindAllUsings } from '../binder/using-directives.js';
import { checkGlobalUsingPlacement } from '../binder/global-usings.js';
import { builtinOwners } from '../symbols/registry-builtins.js';

export class AnalysisCore {
  /**
   * @param {object[]} files parsed files (`parse()` results with `syntax`, `source`, `directives`)
   * @param {object} [options] compilation options: langVersion, langVersionByUri, nullableContext, name, references (imported global namespaces)
   * `captureInvocations` additionally retains editor method-group candidates; diagnostics/emission leave it disabled.
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
    this.conversions = new Conversions(this.core, {
      numericIntPtr: latest >= 11,
      firstClassSpans: latest >= 14,
      unionPreview: this.versionOf(this.files[0]?.source.uri).preview === true,
    });
    this.overloads = new OverloadResolver(this.conversions, this.core);
    // C# 7.3: the constraints of a generic candidate take part in overload resolution (overload/resolution.js).
    this.overloads.violatesConstraints = method => checkConstructedMethod(method, this.core).some(violation => violation.severity !== 'warning');
    this.operators = new OperatorResolver(this.conversions, this.core, this.overloads);
    this.constructions = [];
    this.nullableMaps = new Map();
    this.bound = new Map();
    this.invocations = options.captureInvocations === true ? new Map() : null;
    this.constantState = new Map();
    this.unexecutable = new Map();
    this.typeBinder = new TypeBinder({
      core: this.core,
      report: (uri, node, code, args) => this.report(uri, node, code, args),
      constructions: this.constructions,
      tolerateNamespace: (name, options) => this.tolerateNamespace(name, options),
      isFrameworkGap: (namespaceName, name) => this.isFrameworkGap(namespaceName, name),
      useFeature: (uri, node, feature) => this.gate(uri, node, feature),
      languageVersionAt: uri => this.versionOf(uri).number,
      allowUnsafe: !!options.allowUnsafe,
      unknownUsing: () => {
        this.hasUnknownUsings = true;
      },
      useSite: (symbol, uri, node, options) => this.reportUseSite(symbol, uri, node, options),
      noteUse: (symbol, uri, node) => this.noteUse(symbol, uri, node),
      externAlias: name => this.references.externAlias(name),
      forwardedToMissingAssembly: metadataName => this.references.forwardedToMissingAssembly(metadataName),
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
      useFeature: (uri, node, feature) => this.gate(uri, node, feature),
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
  /**
   * Reports the use-site diagnostics of an imported symbol. A unified assembly reference (CS1701, CS1702, CS1705)
   * is reported once for the compilation and without a source location, as Roslyn does; the others at `node`.
   */
  reportUseSite(symbol, uri, node, options) {
    for (const d of this.references.useSiteDiagnostics(symbol, options)) {
      if (this.references.isUnification(d.code)) this.report(this.files[0]?.source.uri, { start: 0, end: 0 }, d.code, d.args);
      else this.report(uri, node, d.code, d.args);
    }
  }

  /** Retain method groups per document; syntax keys also preserve incomplete-call nesting boundaries. */
  recordInvocation(context, syntax, target, result) {
    let invocations = this.invocations.get(context.uri);
    if (!invocations) this.invocations.set(context.uri, invocations = new Map());
    invocations.set(syntax, {target, result,
      isStatic: context.isStatic, instanceInitializer: context.isFieldInitializer && !context.isStaticInitializer});
  }
  /** The reason (`{code,args}`) the nearest unresolved base type of an imported type is missing, or null. */
  missingBaseReason(type) {
    for (let t = type, depth = 0; t && depth < 64; t = t.baseType, depth++) {
      if (t.isErrorType?.()) return t.reason ?? null;
    }
    return null;
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
  /**
   * A namespace of the base class library that the closed registry does not model is accepted in a using directive.
   * Only namespaces that exist in the BCL are: `System.Nope` is as unknown here as it is to Roslyn.
   */
  tolerateNamespace(name, { isImplicit = false } = {}) {
    if (this.references.hasCoreLibrary || !isBclNamespace(name)) return false;
    // An implicit using nobody wrote does not make the analysis incomplete by itself: only a name that is then
    // not found does (isKnownFrameworkName), because it may be a type of that namespace.
    if (isImplicit) this.hasUnknownImplicitUsings = true;
    else this.incomplete = true;
    return true;
  }
  /**
   * True when `name` is missing from the registry's `namespaceName` although the BCL has it: a child namespace of
   * the BCL, or one of the common BCL type names in a BCL namespace. Such a name is not an error; the analysis is
   * incomplete instead.
   */
  isFrameworkGap(namespaceName, name) {
    if (this.references.hasCoreLibrary) return false;
    const isGap = isBclNamespace(namespaceName + '.' + name) || (isBclNamespace(namespaceName) && frameworkNames.has(name));
    if (isGap && this.typeBinder.host.bindingImplicitUsing) this.hasUnknownImplicitUsings = true;
    else if (isGap) this.incomplete = true;
    return isGap;
  }
  /** Names of common BCL types the registry does not model: using one is not an error, it only makes the analysis incomplete. */
  isKnownFrameworkName(name) {
    if (this.references.hasCoreLibrary) return false;
    if (frameworkNames.has(name) || this.hasUnknownImplicitUsings) {
      this.incomplete = true;
      return true;
    }
    return false;
  }
  /** Profile-only receiver aliases, consulted after lexical names and using-static members. */
  executionBuiltin(name) {
    if (!this.options.executionBuiltinAliases || this.references.hasCoreLibrary || !Object.hasOwn(builtinOwners, name)) return null;
    return this.references.coreLibrary.bridge.typeFromName(builtinOwners[name]);
  }
  /** True when every base class of `type` is declared in source (or is one of the fully modelled roots), so a missing member really is missing. */
  closedHierarchy(type) {
    if (this.hasUnknownUsings) return false;
    if (type.typeKind === TypeKind.TypeParameter)
      return !type.hasUnknownConstraint && [...type.constraintTypes].every(c => this.closedHierarchy(c));
    // With a referenced core library every type is read from metadata with all its members: only a type that could
    // not be resolved leaves the hierarchy open.
    if (this.references.hasCoreLibrary) return !baseTypeChain(type, this.core).some(t => t.isErrorType?.());
    if (type.typeKind === TypeKind.Delegate || type.elementType) return false;
    for (const t of baseTypeChain(type, this.core)) {
      // The members of a source type and of an anonymous type are all known.
      if (isSourceSymbol(t) || t.isAnonymousType) continue;
      if (['System_Object', 'System_ValueType', 'System_Enum'].includes(t.specialType)) continue;
      return false;
    }
    return type.typeKind !== TypeKind.Interface || (isSourceSymbol(type) && type.allInterfaces.every(i => isSourceSymbol(i)));
  }
  /**
   * The registry lists a subset of each framework type's members, so a missing member proves nothing. Reference
   * assemblies list them all.
   */
  registryIsComplete() {
    return this.references.hasCoreLibrary;
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
      length = Math.max(code === DiagnosticId.CS0162 || s.end > start ? (s.end ?? start) - start : 1, s.end === start ? 0 : 1);
    const sameSpan = d => d.start === start && d.length === (length || 1);
    if (this.diagnostics.some(d => d.code === code && d.uri === source.uri && sameSpan(d) && d.message === message)) return;
    this.diagnostics.push(diagnostic(source, start, length || 1, code, message, severity));
  }
  /**
   * Declares the types and binds only the using and extern alias directives: enough for their diagnostics, without
   * binding a single member or body. Returns the `run()` shape with `usingsOnly: true`.
   */
  runUsings() {
    this.assembly.declare(this.globalNamespace);
    this.bindUsings();
    return { diagnostics: this.diagnostics, incomplete: true, usingsOnly: true, assembly: this.assembly, bound: this.bound, core: this.core };
  }
  /** Using and extern alias directives are bound (and checked) whether or not a lookup reaches them. */
  bindUsings() {
    for (const file of this.files)
      for (const row of checkGlobalUsingPlacement(file)) this.report(file.source.uri, row.node, row.code, row.args);
    for (const scope of this.assembly.usingScopes) bindAllUsings(this.typeBinder, scope);
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
    this.bindUsings();
    for (const type of types) type.baseType;
    for (const type of types) type.getMembers();
    for (const type of types) this.bindExplicitInterfaces(type);
    for (const type of types) this.checkType(type);
    this.checkConstructions();
    for (const type of types) this.bindConstants(type);
    this.checkUnsafeDeclarations();
    this.bindAttributes();
    this.checkSpecialMembers();
    this.checkConditionalMethods();
    this.bindBodies();
    // Constructed types written inside bodies (`new Box<int>()`) are checked once the bodies are bound.
    this.checkConstructions();
    this.reportObsoleteUses();
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
  /** The preprocessor symbols defined in the file `uri` (the option plus its #define directives). */
  definedSymbols(uri) {
    this.definedByUri ??= new Map(this.files.map(file => [file.source.uri, definedSymbols(file, this.options)]));
    return this.definedByUri.get(uri) ?? new Set();
  }
  at(symbol) {
    return symbol.locations?.[0] ?? this.assembly.types[0]?.locations[0];
  }
  reportAt(symbol, code, args, severity) {
    const at = this.at(symbol);
    if (at) this.report(at.uri, at, code, args, severity);
  }
}
