/**
 * Binding type syntax to type symbols over the lossless syntax tree (SF-A02-T24, T02.1).
 *
 * `Scope` is the lexical chain a name is looked up in: compilation unit (global namespace + the file's usings),
 * namespace declarations (each with its own usings), types (nested types, inherited nested types, type parameters)
 * and methods (type parameters). `TypeBinder.bindType` turns PredefinedType, IdentifierName, GenericName,
 * QualifiedName, AliasQualifiedName, ArrayType, NullableType, TupleType, PointerType and RefType into symbols and
 * reports, on the span of the offending name: CS0246, CS0234, CS0426, CS0104, CS0118, CS0305, CS0308, CS0122, CS0307.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import {
  SymbolKind,
  TypeKind,
  ErrorTypeSymbol,
  TypeWithAnnotations,
  NullableAnnotation,
  PointerTypeSymbol,
  NamedTypeSymbol,
  ConstructedNamedTypeSymbol,
  DynamicTypeSymbol,
} from '../symbols/types.js';
import { isAccessible } from './accessibility.js';
import { assemblyConflict, dottedName } from './reference-lookup.js';
import { bindUsingDirectives, bindAliasTarget } from './using-directives.js';
import { constructType } from '../symbols/substitution.js';
import { tupleNameProblems, tupleTypeOf } from './tuples.js';
import { bindFunctionPointerType } from './function-pointers.js';
import { isRefLike } from './ref-struct.js';

export class Scope {
  /** @param {'unit'|'namespace'|'type'|'typeParameters'} kind */
  constructor(kind, data, parent = null) {
    this.kind = kind;
    this.parent = parent;
    Object.assign(this, data);
    this.uri = data.uri ?? parent?.uri ?? null;
  }
  child(kind, data) {
    return new Scope(kind, data, this);
  }
  /** The innermost enclosing type symbol, or null. */
  get containingType() {
    for (let s = this; s; s = s.parent) if (s.kind === 'type') return s.type;
    return null;
  }
  /** Namespace levels from the innermost outward, each with its usings (for extension-method scopes). */
  get namespaceChain() {
    const out = [];
    for (let s = this; s; s = s.parent)
      if (s.kind === 'namespace' || s.kind === 'unit') out.push({ namespace: s.namespace, usings: s.usings?.bound ?? null, scope: s });
    return out;
  }
}
const error = (name, arity = 0) => new ErrorTypeSymbol(name, arity);
const twa = (type, annotation = NullableAnnotation.Oblivious) => new TypeWithAnnotations(type, annotation);
/** `var` is recognised only as the whole type of a declaration, never as an element type (`var[]`, `var?`). */
const elementOptions = options => (options.allowVar ? { ...options, allowVar: false } : options);
const kindWord = s =>
  s.kind === SymbolKind.Namespace
    ? 'namespace'
    : s.kind === SymbolKind.NamedType || s.kind === SymbolKind.TypeParameter
      ? 'type'
      : s.kind === SymbolKind.Method
        ? 'method'
        : s.kind === SymbolKind.Field
          ? 'field'
          : s.kind === SymbolKind.Property
            ? 'property'
            : 'variable';

export class TypeBinder {
  /**
   * @param {{core:object, globalNamespace:object, report:(uri,node,code,args)=>void, nullableAnnotationsAt?:(uri,position)=>boolean,
   *   tolerateNamespace?:(name)=>boolean}} host
   */
  constructor(host) {
    this.host = host;
    this.core = host.core;
  }
  report(scope, node, code, args = []) {
    this.host.report(scope.uri, node, code, args);
  }
  /** The bound using directives of a unit or namespace scope (bound on first use): see ./using-directives.js. */
  usingsOf(scope) {
    const outer = () => new Scope(scope.kind, { namespace: scope.namespace, usings: null, uri: scope.uri }, scope.parent);
    return bindUsingDirectives(this, scope, outer);
  }
  aliasTarget(entry) {
    return bindAliasTarget(this, entry);
  }
  /**
   * Looks a simple name up as a type or namespace through the scope chain.
   * @returns a symbol, or `{ambiguous:[a,b]}`, or null; with `options.aliasConflicts`, `{aliasConflict:namespace}` when
   *   a using alias of the scope has the name of a member of that scope's namespace (CS0576)
   */
  lookup(name, arity, scope, options = {}) {
    for (let s = scope; s; s = s.parent) {
      if (s.kind === 'typeParameters') {
        if (arity === 0) {
          const p = s.parameters.find(x => x.name === name);
          if (p) return p;
        }
        continue;
      }
      if (s.kind === 'type') {
        const type = s.type;
        if (arity === 0) {
          const p = type.typeParameters.find(x => x.name === name);
          if (p) return p;
        }
        // Nested types of the type and of its base types; a type whose base list is being bound does not look into its bases.
        const seen = new Set();
        for (
          let t = type;
          t && !seen.has(t);
          t = options.basesBeingResolved?.has(t.originalDefinition) ? null : t.originalDefinition.isResolvingBase ? null : t.baseType
        ) {
          seen.add(t);
          const nested = t.getTypeMembers(name, arity);
          if (nested.length) return nested[0];
          if (options.all) {
            const wrong = t.getTypeMembers(name);
            if (wrong.length) return { wrongArity: wrong[0] };
          }
        }
        continue;
      }
      // unit / namespace: the file-local types of this file come first (C# 11).
      const fileType = s.fileTypes?.get(name + '`' + arity);
      if (fileType) return fileType;
      const ns = s.namespace,
        types = ns.getTypeMembers(name, arity);
      if (options.aliasConflicts && arity === 0 && (types.length || ns.getNamespace(name)) && this.usingsOf(s)?.aliases.has(name))
        return { aliasConflict: ns };
      if (types.length > 1 && types[0] !== types[1])
        return types.some(t => t.locations?.length) && !types.every(t => t.locations?.length)
          ? types.find(t => t.locations?.length)
          : types[0];
      if (types.length) return types[0];
      if (arity === 0) {
        const child = ns.getNamespace(name);
        if (child) return child;
      }
      const usings = this.usingsOf(s);
      if (usings) {
        if (arity === 0 && usings.aliases.has(name)) {
          const target = this.aliasTarget(usings.aliases.get(name));
          if (target) return target;
        }
        const found = [];
        for (const imported of usings.namespaces)
          for (const t of imported.getTypeMembers(name, arity)) if (!found.some(x => x === t)) found.push(t);
        for (const st of usings.staticTypes) for (const t of st.getTypeMembers(name, arity)) if (!found.includes(t)) found.push(t);
        if (found.length === 1) return found[0];
        if (found.length > 1) return { ambiguous: found };
      }
      if (options.all) {
        const wrong = ns.getTypeMembers(name);
        if (wrong.length) return { wrongArity: wrong[0] };
      }
    }
    return null;
  }
  /** Binds a name syntax that may denote a namespace or a type. Returns the symbol (types are bare TypeSymbols) or an ErrorTypeSymbol. */
  bindNamespaceOrType(syntax, scope, options = {}) {
    switch (syntax.kind) {
      case 'IdentifierName':
      case 'GenericName': {
        const name = syntax.identifier.valueText,
          args = syntax.kind === 'GenericName' ? syntax.typeArgumentList.arguments : [],
          arity = args.length;
        if (syntax.identifier.isMissing) return error('');
        let found = this.lookup(name, arity, scope, { ...options, aliasConflicts: true });
        if (found?.aliasConflict) {
          if (!options.quiet) this.report(scope, syntax.identifier, DiagnosticId.CS0576, [found.aliasConflict.toDisplayString(), name]);
          return error(name, arity);
        }
        if (!found) {
          const other = this.lookup(name, arity, scope, { ...options, all: true });
          if (other?.wrongArity) return this.arityError(scope, syntax, other.wrongArity, arity);
          if (this.host.isKnownFrameworkName?.(name)) {
            const e = error(name, arity);
            e.isFrameworkGap = true;
            return e;
          }
          const missing = {
            node: syntax.kind === 'GenericName' ? syntax : syntax.identifier,
            code: DiagnosticId.CS0246,
            args: [name + (arity ? '<>' : '')],
          };
          if (options.quietMissingNamespace) {
            const e = error(name, arity);
            e.missing = missing;
            return e;
          }
          if (!options.quiet) this.report(scope, missing.node, missing.code, missing.args);
          return error(name, arity);
        }
        if (found.ambiguous) {
          if (!options.quiet)
            this.report(scope, syntax.identifier, DiagnosticId.CS0104, [
              name,
              found.ambiguous[0].toDisplayString(),
              found.ambiguous[1].toDisplayString(),
            ]);
          return error(name, arity);
        }
        if (found.wrongArity) return this.arityError(scope, syntax, found.wrongArity, arity);
        return this.finish(found, args, scope, syntax, options);
      }
      case 'QualifiedName': {
        const left = this.bindNamespaceOrType(syntax.left, scope, { ...options, quietMissingNamespace: true });
        if (!left || left.kind === SymbolKind.ErrorType) {
          if (!left?.missing) {
            const e = error(syntax.right.identifier.valueText);
            e.isFrameworkGap = !!left?.isFrameworkGap;
            return e;
          }
          if (this.reportForwardedType(syntax, scope, options)) return error(syntax.right.identifier.valueText);
          if (options.quietMissingNamespace) return left;
          if (!options.quiet) this.report(scope, left.missing.node, left.missing.code, left.missing.args);
          return error(syntax.right.identifier.valueText);
        }
        return this.member(left, syntax.right, scope, options);
      }
      case 'AliasQualifiedName': {
        const alias = syntax.alias.identifier.valueText;
        let root = null;
        if (alias === 'global') root = this.host.globalNamespace;
        else
          for (let s = scope; s && !root; s = s.parent) {
            const u = this.usingsOf(s);
            if (u?.externAliases.has(alias)) root = u.externAliases.get(alias);
            else if (u?.aliases.has(alias)) root = this.aliasTarget(u.aliases.get(alias));
          }
        if (!root) {
          if (!options.quiet) this.report(scope, syntax.alias, DiagnosticId.CS0432, [alias]);
          return error(alias);
        }
        if (root.kind !== SymbolKind.Namespace) {
          // `A::B` needs a namespace alias; an alias of a type is used with `.`.
          if (root.kind !== SymbolKind.ErrorType && !options.quiet) this.report(scope, syntax.alias, DiagnosticId.CS0431, [alias]);
          return error(alias);
        }
        return this.member(root, syntax.name, scope, options);
      }
      default:
        return this.bindType(syntax, scope, options).type;
    }
  }
  /** CS1069 for `Namespace.Type` when a referenced assembly forwards the type to an assembly that is not referenced. */
  reportForwardedType(syntax, scope, options) {
    const name = dottedName(syntax),
      assembly = name ? this.host.forwardedToMissingAssembly?.(name) : null;
    if (!assembly) return false;
    const right = syntax.right.identifier;
    if (!options.quiet) this.report(scope, right, DiagnosticId.CS1069, [right.valueText, name.slice(0, name.lastIndexOf('.')), assembly]);
    return true;
  }
  member(container, right, scope, options) {
    const name = right.identifier.valueText,
      args = right.kind === 'GenericName' ? right.typeArgumentList.arguments : [],
      arity = args.length;
    if (right.identifier.isMissing) return error('');
    if (container.kind === SymbolKind.Namespace) {
      const types = container.getTypeMembers(name, arity),
        conflict = assemblyConflict(types);
      if (conflict) {
        if (!options.quiet) this.report(scope, right.identifier, DiagnosticId.CS0433, conflict);
        return error(name, arity);
      }
      let found = types[0] ?? (arity === 0 ? container.getNamespace(name) : null);
      if (!found) {
        const wrong = container.getTypeMembers(name)[0];
        if (wrong) return this.arityError(scope, right, wrong, arity);
        if (this.host.isFrameworkGap?.(container.toDisplayString(), name)) {
          const e = error(name, arity);
          e.isFrameworkGap = true;
          return e;
        }
        const missing = {
          node: right.kind === 'GenericName' ? right : right.identifier,
          code: DiagnosticId.CS0234,
          args: [name, container.toDisplayString()],
        };
        if (options.quietMissingNamespace) {
          const e = error(name, arity);
          e.missing = missing;
          return e;
        }
        if (!options.quiet) this.report(scope, missing.node, missing.code, missing.args);
        return error(name, arity);
      }
      return this.finish(found, args, scope, right, options);
    }
    if (container.kind === SymbolKind.TypeParameter) {
      this.report(scope, right.identifier, DiagnosticId.CS0704, [container.name]);
      return error(name, arity);
    }
    let found = null;
    for (let t = container; t && !found; t = t.baseType) found = (t.originalDefinition ?? t).getTypeMembers?.(name, arity)[0] ?? null;
    if (!found) {
      if (!options.quiet) this.report(scope, right.identifier, DiagnosticId.CS0426, [name, container.toDisplayString()]);
      return error(name, arity);
    }
    return this.finish(found, args, scope, right, options, container);
  }
  arityError(scope, syntax, symbol, arity) {
    if (symbol.arity) this.report(scope, syntax, DiagnosticId.CS0305, [symbol.toDisplayString(), 'type', symbol.arity]);
    else this.report(scope, syntax, DiagnosticId.CS0308, [symbol.toDisplayString(), 'type']);
    return error(symbol.name, arity);
  }
  /** Applies type arguments and accessibility to a looked-up symbol. */
  finish(symbol, argSyntax, scope, syntax, options, container = null) {
    if (symbol.kind === SymbolKind.Namespace || symbol.kind === SymbolKind.TypeParameter) return symbol;
    if (symbol.containingAssembly && !options.quiet) this.host.useSite?.(symbol, scope.uri, syntax.identifier ?? syntax, { missingBases: false });
    if (symbol.kind === SymbolKind.NamedType && !options.quiet && !options.isAliasQualifiedExpression) this.host.noteUse?.(symbol, scope.uri, syntax);
    if (symbol.kind === SymbolKind.NamedType && !options.quiet && !options.skipAccessCheck) {
      const within = scope.containingType;
      if (
        symbol.locations?.length &&
        !isAccessible(symbol.originalDefinition, within?.originalDefinition ?? null, { withinModule: this.host.module })
      )
        this.report(scope, syntax.identifier ?? syntax, DiagnosticId.CS0122, [symbol.toDisplayString()]);
    }
    if (!argSyntax.length) {
      // A nested type named from inside a generic container keeps the container's own type parameters.
      if (container instanceof ConstructedNamedTypeSymbol && symbol instanceof NamedTypeSymbol)
        return new ConstructedNamedTypeSymbol(symbol.originalDefinition, symbol.originalDefinition.typeArguments, container);
      return symbol;
    }
    if (argSyntax.every(a => a.kind === 'OmittedTypeArgument')) {
      symbol.isUnboundReference = true;
      return symbol;
    }
    const args = argSyntax.map(a => this.bindType(a, scope, options));
    const constructed = constructType(symbol, args, container instanceof ConstructedNamedTypeSymbol ? container : null);
    (options.constructions ?? this.host.constructions)?.push({ type: constructed, syntax, scope, argSyntax });
    return constructed;
  }
  /**
   * Binds a type syntax to a TypeWithAnnotations (never null; unknown types are ErrorTypeSymbols).
   * @param {{allowVar?:boolean, quiet?:boolean}} [options] with `allowVar`, the identifier `var` binds to `{isVar:true}` when no type named var is in scope
   */
  bindType(syntax, scope, options = {}) {
    const annotations = this.host.nullableAnnotationsAt?.(scope.uri, syntax.spanStart) ?? false,
      plain = t => twa(t, annotations && (t.isReferenceType === true || (t.kind === SymbolKind.TypeParameter && t.isValueType !== true))
        ? NullableAnnotation.NotAnnotated : NullableAnnotation.Oblivious);
    switch (syntax.kind) {
      case 'PredefinedType': {
        const t = this.core.keyword(syntax.keyword.text);
        return t ? plain(t) : twa(error(syntax.keyword.text));
      }
      case 'IdentifierName': {
        const name = syntax.identifier.valueText;
        if (name === 'var' && !this.lookup('var', 0, scope)) {
          if (options.allowVar) return { isVar: true, type: error('var'), nullableAnnotation: NullableAnnotation.Oblivious };
          // `var` is a type only in a local declaration: a field, a parameter, `var[]` and `var?` are CS0825.
          if (!options.quiet) this.report(scope, syntax, DiagnosticId.CS0825);
          return twa(error('var'));
        }
        if ((name === 'nint' || name === 'nuint') && !this.lookup(name, 0, scope)) {
          this.host.useFeature?.(scope.uri, syntax, 'NativeInt');
          return plain(this.core.keyword(name));
        }
        // 'dynamic' is a type from C# 4; before that it is an ordinary name (CS0246 unless something declares it).
        const hasDynamic = (this.host.languageVersionAt?.(scope.uri) ?? 4) >= 4;
        if (name === 'dynamic' && hasDynamic && !this.lookup(name, 0, scope)) return plain(DynamicTypeSymbol.instance);
      }
      // falls through
      case 'GenericName':
      case 'QualifiedName':
      case 'AliasQualifiedName': {
        const symbol = this.bindNamespaceOrType(syntax, scope, options);
        if (symbol.kind === SymbolKind.Namespace) {
          if (!options.quiet) this.report(scope, syntax, DiagnosticId.CS0118, [symbol.toDisplayString(), 'namespace', 'type']);
          return twa(error(symbol.name));
        }
        return plain(symbol);
      }
      case 'ArrayType': {
        let element = this.bindType(syntax.elementType, scope, elementOptions(options));
        if (element.type.isStatic && element.type.kind === SymbolKind.NamedType)
          this.report(scope, syntax.elementType, DiagnosticId.CS0719, [element.type.toDisplayString()]);
        // A ref struct lives on the stack: it cannot be the element of an array, wherever the array type is written.
        if (isRefLike(element.type)) this.report(scope, syntax.elementType, DiagnosticId.CS0611, [element.type.toDisplayString()]);
        // Rank specifiers read left to right from the outside in: int[][,] is an array of int[,].
        for (const rank of [...syntax.rankSpecifiers].reverse()) element = plain(this.core.arrayOf(element, rank.sizes.length || 1));
        return element;
      }
      case 'NullableType': {
        const element = this.bindType(syntax.elementType, scope, elementOptions(options)),
          t = element.type;
        if (t.kind === SymbolKind.ErrorType) return element;
        if (t.isValueType === true) {
          if (t.isNullableValueType) {
            this.report(scope, syntax, DiagnosticId.CS0453, [this.core.nullable.toDisplayString(), 'T', t.toDisplayString()]);
            return element;
          }
          return twa(this.core.nullableOf(element), NullableAnnotation.Annotated);
        }
        // T? on an unconstrained type parameter or reference type is an annotation (C# 8 nullable reference types).
        if (!options.quiet) {
          const mark = syntax.questionToken ?? syntax,
            available = this.host.useFeature?.(scope.uri, mark, 'NullableReferenceTypes');
          // Outside a `#nullable` annotations context the annotation is accepted and has no effect (CS8632).
          if (available !== false && this.host.nullableAnnotationsAt?.(scope.uri, mark.span?.start ?? 0) === false) this.report(scope, mark, DiagnosticId.CS8632);
        }
        return twa(t, NullableAnnotation.Annotated);
      }
      case 'TupleType': {
        const elements = syntax.elements.map(e => this.bindType(e.type, scope, options)),
          names = syntax.elements.map(e => e.identifier?.valueText ?? null);
        if (elements.length < 2) return twa(error('ValueTuple', elements.length));
        if (!options.quiet)
          for (const problem of tupleNameProblems(names)) this.report(scope, syntax.elements[problem.index].identifier, problem.code, problem.args);
        return twa(tupleTypeOf(this.core.bridge, elements, names));
      }
      case 'PointerType':
        return twa(new PointerTypeSymbol(this.bindType(syntax.elementType, scope, options)));
      case 'FunctionPointerType':
        return twa(
          bindFunctionPointerType(
            syntax,
            type => this.bindType(type, scope, options),
            (node, code, args) => options.quiet || this.report(scope, node, code, args),
          ),
        );
      case 'RefType':
      case 'ScopedType':
        return this.bindType(syntax.type, scope, options);
      case 'OmittedTypeArgument':
        return twa(error(''));
      default:
        return twa(error(syntax.toString()));
    }
  }
  /** What a symbol is called in CS0118/CS0119 messages. */
  static kindWord = kindWord;
}
