/**
 * The semantic model over the semantic analysis (SF-A02-T38): the queries a language service asks, answered for every
 * program the analysis binds - also one the execution profile cannot run (structs, interfaces, generics, ...).
 *
 *   getSymbolInfo(node)       the symbol an expression, a name or a type syntax refers to
 *   getTypeInfo(node)         `{type, convertedType}`: the type of an expression and the type it is converted to
 *   getConversion(node)       the implicit conversion applied to an expression (identity when there is none)
 *   getConstantValue(node)    the compile-time constant value
 *   getDeclaredSymbol(node)   the symbol a declaration introduces
 *   getDiagnostics(span?)     the diagnostics of the analysis, optionally those that overlap a span
 *   lookupSymbols, bindSpeculativeExpression, analyzeDataFlow, analyzeControlFlow   (./model-scopes.js, ./model-regions.js)
 *
 * A node is identified by its span: a syntax node of the lossless tree, a node of the profile's tree or a plain
 * `{start, end, uri?}` all work. The model runs one analysis when it is created and never changes it.
 */
import { SemanticAnalysis } from '../semantic-analysis.js';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { SymbolKind } from '../symbols/types.js';
import { ModelIndex, spanOf, symbolOfBound, syntaxNodesAt } from './model-index.js';
import { BodyBinder } from '../binder/body-binder.js';
import { ScopeQueries } from './model-scopes.js';
import { RegionQueries } from './model-regions.js';
import { namedTupleElement, namedDeconstructionType } from './model-tuples.js';

const identity = new Conversion(ConversionKind.Identity);
const typeSyntaxKinds = new Set([
  'PredefinedType',
  'IdentifierName',
  'QualifiedName',
  'GenericName',
  'AliasQualifiedName',
  'ArrayType',
  'NullableType',
  'TupleType',
  'PointerType',
]);
const declarationKinds = new Set(['FieldDeclaration', 'EventFieldDeclaration', 'LocalDeclarationStatement', 'VariableDeclaration']);
const nameKinds = new Set(['IdentifierName', 'QualifiedName', 'GenericName', 'AliasQualifiedName']);
const found = symbol => ({ symbol, candidateSymbols: [], candidateReason: 'none' });
const notFound = Object.freeze({ symbol: null, candidateSymbols: [], candidateReason: 'notFound' });
const isStatement = node => 'completes' in node;
const isImplicitConversion = node => node.kind === 'Conversion' && !node.isExplicit;
/** Of the nodes that share a span (outermost first): the innermost one that is not an implicit conversion. */
const writtenOf = nodes => nodes.findLast(bound => !isImplicitConversion(bound)) ?? nodes.at(-1) ?? null;
/** A declaration scope in which the type parameters of the declaration are visible. */
const withTypeParameters = (scope, parameters) => (scope && parameters.length ? scope.child('typeParameters', { parameters }) : scope);
/** `{ a, b }` of an object, collection or array creation is not a value: it has no type of its own. */
const isInitializer = node => /InitializerExpression$/.test(node?.syntax?.kind ?? '');

class AnalysisModelCore {
  /**
   * @param {object[]} files `parse()` results  @param {object} [options] the compilation options (langVersion, ...)
   */
  constructor(files, options = {}) {
    this.files = files;
    this.options = options;
    this.driver = new SemanticAnalysis(files, options);
    this.analysis = this.driver.run();
    this.core = this.analysis.core;
    this.defaultUri = files[0]?.source.uri;
    this.index = new ModelIndex(this.analysis, this.defaultUri);
  }
  /** False when the analysis could not bind everything (a member the closed framework registry does not list). */
  get isComplete() {
    return !this.analysis.incomplete && !this.analysis.unsupported;
  }
  fileOf(uri) {
    return this.files.find(file => file.source.uri === uri) ?? null;
  }
  /** `{uri, span}` of a query node, or null when it has no span. */
  locate(node) {
    const span = spanOf(node);
    return span ? { uri: this.index.uriOf(node), span } : null;
  }
  /**
   * The bound expressions at a node, outermost first (statements excluded). Several nodes share a span when one is
   * synthesized around the written expression: an implicit conversion, the `Add` call of a collection initializer
   * element. The name part of a member access has the nodes of the access.
   */
  expressionsAt(node) {
    const at = this.locate(node);
    if (!at) return [];
    const nodes = this.index.nodesAt(at.uri, at.span).filter(bound => !isStatement(bound));
    if (nodes.length) return nodes;
    const access = this.index.accessNamedAt(at.uri, at.span).filter(bound => !isStatement(bound));
    if (access.length) return access;
    // `(e)` has no bound node of its own: it is `e`.
    const syntaxes = this.syntaxAt(node),
      parenthesized = syntaxes.find(syntax => syntax.kind === 'ParenthesizedExpression');
    if (parenthesized) return this.expressionsAt({ uri: at.uri, ...parenthesized.expression.span });
    // A literal outside a bound body (a constant or enum member initializer) is bound here: it depends on nothing.
    const literal = syntaxes.find(syntax => /LiteralExpression$/.test(syntax.kind)),
      scope = literal ? this.typeScopeAt(at.uri, at.span.start) : null;
    return scope ? [this.literalBinder(at.uri, scope).expression(literal)] : [];
  }
  /** A binder for expressions that name nothing; what it would report is dropped. */
  literalBinder(uri, scope) {
    const shadow = Object.assign(Object.create(this.driver), { report: () => {}, noteUse: () => {}, gate: () => true });
    return new BodyBinder(shadow, { uri, scope, containingType: scope.containingType, method: null, isStatic: true, isFieldInitializer: true, parameters: [] });
  }
  /** The bound node of a syntax node: the expression as written, without what is applied around it. */
  getBoundNode(node) {
    return writtenOf(this.expressionsAt(node));
  }
  /** The lossless syntax nodes with exactly the span of a query node, outermost first. */
  syntaxAt(node) {
    const at = this.locate(node),
      root = at ? this.fileOf(at.uri)?.syntax : null;
    return root ? syntaxNodesAt(root, at.span) : [];
  }
  /** The scope in which a type or namespace name at a position is bound. */
  typeScopeAt(uri, position) {
    const entry = this.index.bodyAt(uri, position);
    if (entry?.body.binder) return entry.body.binder.typeScope;
    let best = null;
    const consider = (span, scope) => {
      if (!scope || !span || position < span.start || position > span.end) return;
      if (!best || span.end - span.start <= best.width) best = { width: span.end - span.start, scope };
    };
    const visit = type => {
      for (const declaration of type.declarations ?? []) {
        const parameters = type.typeParameters ?? [];
        if (declaration.uri === uri) consider(spanOf(declaration.syntax), withTypeParameters(declaration.scope, parameters));
      }
      for (const member of type.getMembers()) {
        if ((member.uri ?? uri) !== uri || !member.scope) continue;
        // The type parameters of a generic method are in scope in its signature.
        consider(spanOf(member.syntax), withTypeParameters(member.scope, member.typeParameters ?? []));
      }
      for (const nested of type.getTypeMembers?.() ?? []) if (nested.isSource) visit(nested);
    };
    for (const type of this.analysis.assembly.types) visit(type);
    return best?.scope ?? this.analysis.assembly.unitScopes.get(uri) ?? null;
  }
  /** The type `var` stands for: the type of the variable its declaration introduces. */
  inferredTypeOf(syntax, uri) {
    const parent = syntax.parent,
      declarator = parent?.kind === 'VariableDeclaration' ? parent.variables?.[0] : parent?.kind === 'ForEachStatement' ? parent : null,
      variable = declarator ? this.index.declaredAt(uri, declarator.span) : null;
    if (variable) return variable.type ?? null;
    // `var (a, b)` and `out var x`: the declaration expression has the type.
    return parent?.kind === 'DeclarationExpression' ? (this.getTypeInfo({ uri, ...parent.span }).type ?? null) : null;
  }
  /** The type or namespace a type syntax or a name outside an expression denotes, or null. */
  bindTypeSyntax(node) {
    const at = this.locate(node);
    let syntax = this.syntaxAt(node).findLast(candidate => typeSyntaxKinds.has(candidate.kind));
    if (!syntax) return null;
    if (syntax.kind === 'IdentifierName' && syntax.identifier?.valueText === 'var') return this.inferredTypeOf(syntax, at.uri);
    // The right part of `A.B` is `A.B`.
    if (syntax.parent?.kind === 'QualifiedName' && syntax.parent.right === syntax) syntax = syntax.parent;
    const scope = this.typeScopeAt(at.uri, at.span.start);
    if (!scope) return null;
    const binder = this.driver.typeBinder,
      isName = nameKinds.has(syntax.kind);
    try {
      const symbol = isName ? binder.bindNamespaceOrType(syntax, scope, { quiet: true }) : binder.bindType(syntax, scope, { quiet: true }).type;
      return symbol && !symbol.isErrorType?.() ? symbol : null;
    } catch {
      return null;
    }
  }
  /**
   * The symbol a node refers to: `{symbol, candidateSymbols, candidateReason}`. `candidateReason` is 'none' when a
   * symbol was found, 'overloadResolutionFailure' with the candidates of a method group that was not resolved, else
   * 'notFound'.
   */
  getSymbolInfo(node) {
    const bound = this.getBoundNode(node);
    if (bound) {
      const symbol = namedTupleElement(bound) ?? symbolOfBound(bound) ?? this.arrayMember(bound);
      if (symbol) return found(symbol);
      if (bound.kind === 'MethodGroup' && bound.methods?.length) {
        if (bound.methods.length === 1) return found(bound.methods[0]);
        return { symbol: null, candidateSymbols: [...bound.methods], candidateReason: 'overloadResolutionFailure' };
      }
      return notFound;
    }
    const at = this.locate(node);
    if (!at) return notFound;
    const target = this.index.targets.get(at.uri + '|' + at.span.start + '|' + at.span.end);
    if (target) return found(target);
    const type = this.bindTypeSyntax(node);
    return type ? found(type) : notFound;
  }
  /** `array.Length` and `array.Rank` are bound without a symbol: they are the properties of System.Array. */
  arrayMember(bound) {
    if (bound.kind !== 'ArrayLength') return null;
    return this.core.array?.getMembers(bound.member).find(member => member.kind === SymbolKind.Property) ?? null;
  }
  /** `{type, convertedType}` of an expression or a type syntax; both null when the node has no type. */
  getTypeInfo(node) {
    const nodes = this.expressionsAt(node);
    if (!nodes.length) {
      // A declarator, a foreach statement or a designation has the type of the variable it declares.
      const variable = this.getDeclaredSymbol(node);
      if (variable?.kind === SymbolKind.Local) return { type: variable.type ?? null, convertedType: variable.type ?? null };
      // `var (a, b)` on the left of a deconstruction has the type of the deconstruction.
      const declaration = this.syntaxAt(node).find(syntax => syntax.kind === 'DeclarationExpression'),
        assignment = declaration?.parent?.kind === 'SimpleAssignmentExpression' && declaration.parent.left === declaration ? declaration.parent : null;
      if (assignment) return this.getTypeInfo({ uri: this.locate(node).uri, ...assignment.span });
      const symbol = this.bindTypeSyntax(node),
        type = symbol && symbol.kind !== SymbolKind.Namespace ? symbol : null;
      return { type, convertedType: type };
    }
    const typeOf = bound => (bound.kind === 'TypeExpression' ? bound.referencedType : (bound.type ?? null)),
      written = writtenOf(nodes),
      above = nodes[nodes.indexOf(written) - 1],
      isDeconstruction = written.kind === 'DeconstructionAssignment' && written.syntax.kind === 'SimpleAssignmentExpression',
      type = isInitializer(written) ? null : isDeconstruction ? namedDeconstructionType(typeOf(written), written.syntax.left) : typeOf(written);
    if (isInitializer(written)) return { type, convertedType: written.syntax.kind === 'ArrayInitializerExpression' ? typeOf(written) : null };
    // A lambda has no type of its own; it is converted to the delegate type it was bound for.
    if (written.kind === 'Lambda') return { type, convertedType: written.boundAs ?? (above ? typeOf(above) : null) };
    return { type, convertedType: above && isImplicitConversion(above) ? typeOf(above) : type };
  }
  /** The implicit conversion applied to an expression where it is used; the identity conversion when there is none. */
  getConversion(node) {
    const nodes = this.expressionsAt(node),
      above = nodes[nodes.indexOf(writtenOf(nodes)) - 1];
    return above && isImplicitConversion(above) ? above.conversion : identity;
  }
  /** `{hasValue, value}`: the constant value of an expression as written (before a conversion of the constant). */
  getConstantValue(node) {
    const constant = writtenOf(this.expressionsAt(node))?.constantValue;
    return constant ? { hasValue: true, value: constant.value } : { hasValue: false, value: undefined };
  }
  /** The symbol a declaration introduces, or null when the node is not a declaration. */
  getDeclaredSymbol(node) {
    const at = this.locate(node);
    if (!at) return null;
    const direct = this.index.declaredAt(at.uri, at.span);
    if (direct) return direct;
    const syntaxes = this.syntaxAt(node),
      namespace = syntaxes.find(syntax => /NamespaceDeclaration$/.test(syntax.kind));
    if (namespace) return this.declaredNamespace(namespace);
    // A field, event or local declaration statement declares its (first) variable.
    for (const syntax of syntaxes) {
      const declarator = (syntax.declaration ?? syntax).variables?.[0];
      if (declarator && declarationKinds.has(syntax.kind)) return this.index.declaredAt(at.uri, declarator.span);
    }
    // A node of another tree shape: the declarations inside its span that start where it starts.
    for (const syntax of this.syntaxAt(node)) {
      const symbol = this.index.declaredAt(at.uri, syntax.span);
      if (symbol) return symbol;
    }
    return null;
  }
  /** The namespace a namespace declaration declares (`namespace A.B { }` inside `namespace Z` is `Z.A.B`). */
  declaredNamespace(syntax) {
    const parts = [];
    for (let node = syntax; node; node = node.parent) if (/NamespaceDeclaration$/.test(node.kind)) parts.unshift(node.name.toString().replace(/\s+/g, ''));
    return this.driver.globalNamespace.lookupNamespace(parts.join('.'));
  }
  /** The diagnostics of the analysis; with a span, those that overlap it. */
  getDiagnostics(span = null) {
    const all = this.analysis.diagnostics;
    if (!span) return [...all];
    const uri = span.uri ?? this.defaultUri;
    return all.filter(d => d.uri === uri && d.start < span.end && span.start < d.start + Math.max(1, d.length));
  }
}

/** The semantic model over the semantic analysis: `new AnalysisModel(files, options)` with `parse()` results. */
export class AnalysisModel extends RegionQueries(ScopeQueries(AnalysisModelCore)) {}
