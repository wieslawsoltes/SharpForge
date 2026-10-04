/**
 * The source assembly: declares every type of every file (names, arity, containers, partial merging) and
 * builds the member list of a type on first use.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { mergeGlobalUsings } from '../../binder/global-usings.js';
import { mergePartialMembers } from './partial-members.js';
import { synthesizeRecordMembers } from '../synthesized/records.js';
import { TypeKind, Accessibility } from '../types.js';
import { FieldSymbol, DeclarationModifiers, accessibilityFromSyntax } from '../members.js';
import { NamespaceSymbol, NamespaceExtent } from '../namespaces.js';
import { Scope } from '../../binder/type-binder.js';
import { FileLocalTypes } from '../../binder/file-local-types.js';
import { declareTypeParameters, bindConstraintClauses } from './type-parameters.js';
import { typeKindOf, isTypeDeclaration, words, nameParts, SourceTypeSymbol } from './source-type.js';
import { spanOf } from './source-type.js';

export class SourceAssemblyCore {
  /**
   * @param {{source:{uri:string,text:string},syntax:object}[]} files parsed files (red trees)
   * @param {{core:object, typeBinder:object, report:(uri,node,code,args)=>void, name?:string, evaluateConstant?:Function}} host
   */
  constructor(files, host) {
    this.files = files;
    this.host = host;
    this.core = host.core;
    this.module = Object.freeze({ name: host.name ?? 'Application', kind: 'source' });
    this.globalNamespace = new NamespaceSymbol('', null, NamespaceExtent.Source, this.module);
    this.types = [];
    this.unitScopes = new Map();
    /** Every scope that has using or extern alias directives, in declaration order. */
    this.usingScopes = [];
    this.topLevel = [];
    this.bodies = [];
  }
  report(uri, node, code, args = []) {
    this.host.report(uri, node, code, args);
  }
  /** Declares every type of every file; `merged` is the global namespace lookups go through (source + references). */
  declare(merged) {
    this.merged = merged;
    const globalUsings = mergeGlobalUsings(this.files);
    for (const file of this.files) {
      const uri = file.source.uri,
        unit = new Scope('unit', {
          namespace: merged,
          sourceNamespace: this.globalNamespace,
          fileLocalTypes: new FileLocalTypes(uri),
          usings: {
            directives: [...file.syntax.usings.filter(u => !u.globalKeyword)],
            global: globalUsings.directives,
            globalUris: globalUsings.uriOf,
            externs: [...file.syntax.externs],
            bound: null,
          },
          uri,
        });
      this.unitScopes.set(uri, unit);
      this.usingScopes.push(unit);
      this.declareMembers(file.syntax.members, unit, this.globalNamespace, null, file);
    }
    return this;
  }
  declareMembers(members, scope, namespace, container, file) {
    for (const member of members) {
      if (member.kind === 'NamespaceDeclaration' || member.kind === 'FileScopedNamespaceDeclaration') {
        let ns = namespace,
          inner = scope;
        // `namespace A.B` nests one scope per name part; the usings belong to the innermost.
        const parts = nameParts(member.name);
        parts.forEach((part, i) => {
          ns = ns.getOrAddNamespace(part);
          const merged = inner.namespace.getNamespace(part) ?? ns;
          inner = inner.child('namespace', {
            namespace: merged,
            sourceNamespace: ns,
            usings: i === parts.length - 1 ? { directives: [...member.usings], global: [], externs: [...member.externs], bound: null } : null,
          });
        });
        this.usingScopes.push(inner);
        this.declareMembers(member.members, inner, ns, null, file);
      } else if (isTypeDeclaration(member)) this.declareType(member, scope, namespace, container, file);
      else if (member.kind === 'GlobalStatement') this.topLevel.push({ statement: member.statement, scope, file });
      else if (!container && member.kind !== 'IncompleteMember') this.topLevel.push({ member, scope, file });
    }
  }
  declareType(syntax, scope, namespace, container, file) {
    const uri = file.source.uri,
      name = syntax.identifier.valueText,
      modifiers = words(syntax.modifiers),
      arity = syntax.typeParameterList?.parameters.length ?? 0,
      kind = typeKindOf(syntax);
    // C# 11: a `file` type is declared in the scope of its file, not in the namespace, so only that file finds it.
    const isFileLocal = modifiers.includes('file') && !container,
      fileKey = name + '`' + arity;
    const declaration = { syntax, scope, uri, file },
      siblings = isFileLocal ? scope.fileLocalTypes.getTypeMembers(namespace, name, arity) ?? []
        : container ? container._nested : namespace.getTypeMembers(name, arity),
      existing = siblings.find(t => t.name === name && t.arity === arity && t.isSource);
    if (existing) {
      const partial = modifiers.includes('partial'),
        allPartial = existing.declarations.every(d => words(d.syntax.modifiers).includes('partial'));
      if (partial && allPartial && existing.typeKind === kind) {
        const access = m =>
          m
            .filter(w => ['public', 'internal', 'private', 'protected'].includes(w))
            .sort()
            .join(' ');
        if (
          access(modifiers) &&
          existing.declarations.some(d => access(words(d.syntax.modifiers)) && access(words(d.syntax.modifiers)) !== access(modifiers))
        )
          this.report(existing.declarations[0].uri, existing.declarations[0].syntax.identifier, DiagnosticId.CS0262, [name]);
        existing.declarations.push(declaration);
        this.declareNested(syntax, existing, declaration, file);
        return existing;
      }
      if (partial !== allPartial || (partial && existing.typeKind !== kind))
        this.report(uri, syntax.identifier, existing.typeKind !== kind ? DiagnosticId.CS0261 : DiagnosticId.CS0260, [name]);
      else
        this.report(
          uri,
          syntax.identifier,
          isFileLocal ? DiagnosticId.CS9071 : container ? DiagnosticId.CS0102 : DiagnosticId.CS0101,
          container
            ? [container.toDisplayString(), name]
            : [name, namespace.isGlobalNamespace ? '<global namespace>' : namespace.toDisplayString()],
        );
      // The duplicate is still declared (detached) so its members are checked.
    }
    const interfaceMember = container?.typeKind === TypeKind.Interface;
    const type = new SourceTypeSymbol(
      this,
      {
        name,
        typeKind: kind,
        containingSymbol: container ?? namespace,
        declaredAccessibility: accessibilityFromSyntax(
          modifiers,
          container ? (interfaceMember ? Accessibility.Public : Accessibility.Private) : Accessibility.Internal,
        ),
        isStatic: modifiers.includes('static'),
        isAbstract: modifiers.includes('abstract') || kind === TypeKind.Interface,
        isSealed:
          modifiers.includes('sealed') ||
          kind === TypeKind.Struct ||
          kind === TypeKind.Enum ||
          kind === TypeKind.Delegate ||
          modifiers.includes('static'),
        isReadOnly: modifiers.includes('readonly'),
        isRefLikeType: modifiers.includes('ref') && kind === TypeKind.Struct,
        isRecord: syntax.kind.startsWith('Record'),
        typeParameters: [],
        locations: [{ uri, ...spanOf(syntax.identifier) }],
      },
      declaration,
    );
    type.typeParameters = Object.freeze(declareTypeParameters(syntax.typeParameterList, type, uri, (n, c, a) => this.report(uri, n, c, a)));
    type._typeArguments = null;
    type.modifierWords = modifiers;
    type.isFileLocal = isFileLocal;
    if (existing) type.isDuplicate = true;
    else if (isFileLocal) {
      (scope.fileTypes ??= new Map()).set(fileKey, type);
      scope.fileLocalTypes.add(type);
    }
    else if (container) container._nested.push(type);
    else namespace.addType(type);
    if (container) type.containingSymbol = container;
    this.types.push(type);
    this.declareNested(syntax, type, declaration, file);
    return type;
  }
  declareNested(syntax, type, declaration, file) {
    if (syntax.kind === 'EnumDeclaration' || syntax.kind === 'DelegateDeclaration') return;
    const scope = type.scopeFor(declaration);
    for (const member of syntax.members ?? []) if (isTypeDeclaration(member)) this.declareType(member, scope, null, type, file);
  }
  /** Binds the base list of a type once (see binder/inheritance.js for the rules and diagnostics). */
  resolveBases(type) {
    if (type._baseState === 2) return;
    if (type._baseState === 1) {
      return;
    }
    type._baseState = 1;
    type.isResolvingBase = true;
    try {
      const result = this.host.resolveBases(type, this);
      type._declaredBase = result.baseType;
      type._declaredInterfaces = result.interfaces;
      type.enumUnderlyingType = result.enumUnderlyingType ?? type.enumUnderlyingType;
    } finally {
      type.isResolvingBase = false;
      type._baseState = 2;
    }
    this.host.afterBases?.(type, this);
  }
  bindType(syntax, scope, options) {
    return this.host.typeBinder.bindType(syntax, scope, options);
  }
  /** Builds the member symbols of a type from all of its declarations. */
  buildMembers(type) {
    const members = [];
    type._built = members;
    for (const declaration of type.declarations) {
      const syntax = declaration.syntax,
        scope = type.scopeFor(declaration),
        uri = declaration.uri;
      if (type.typeKind === TypeKind.Delegate) {
        this.delegateMembers(type, syntax, scope, uri, members);
        continue;
      }
      if (type.typeKind === TypeKind.Enum) {
        for (const m of syntax.members) {
          const field = new FieldSymbol({
            name: m.identifier.valueText,
            type,
            containingSymbol: type,
            declaredAccessibility: Accessibility.Public,
            modifiers: DeclarationModifiers.Const | DeclarationModifiers.Static,
            locations: [{ uri, ...spanOf(m.identifier) }],
            syntax: m,
            constantValue: { value: undefined },
          });
          field.isEnumMember = true;
          field.scope = scope;
          members.push(field);
        }
        continue;
      }
      // Constraint clauses of the type itself (each partial declaration may repeat them).
      if (syntax.constraintClauses?.length)
        bindConstraintClauses(
          [...type.typeParameters],
          syntax.constraintClauses,
          t => this.bindType(t, scope).type,
          (n, c, a) => this.report(uri, n, c, a),
          { ownerDisplay: type.toDisplayString(), useFeature: (node, feature) => this.host.useFeature?.(uri, node, feature) },
        );
      if (syntax.parameterList) this.primaryConstructor(type, syntax, scope, uri, members);
      for (const m of syntax.members ?? []) this.member(type, m, scope, uri, members);
    }
    this.implicitConstructors(type, members);
    if (type.isRecord) synthesizeRecordMembers(type, members, this.core);
    // Partial members become one symbol each before duplicates are looked for.
    for (const row of mergePartialMembers(type, members)) {
      const at = row.at ?? row.member.locations?.[0];
      if (at) this.report(at.uri, at, row.code, row.args);
    }
    this.reportConflicts(type, members);
    return members;
  }
}
