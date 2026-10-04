/**
 * The symbol of a type declared in source, and the syntax helpers the source symbol builders share.
 */
import { NamedTypeSymbol, TypeKind, TypeWithAnnotations } from '../types.js';

const typeKinds = {
  ClassDeclaration: TypeKind.Class,
  StructDeclaration: TypeKind.Struct,
  UnionDeclaration: TypeKind.Struct,
  InterfaceDeclaration: TypeKind.Interface,
  EnumDeclaration: TypeKind.Enum,
  DelegateDeclaration: TypeKind.Delegate,
  RecordDeclaration: TypeKind.Class,
  RecordStructDeclaration: TypeKind.Struct,
};

/** The TypeKind a type declaration syntax declares, or undefined for other nodes. */
export const typeKindOf = node => typeKinds[node.kind];
/** True for class, struct, interface, enum, delegate and record declarations. */
export const isTypeDeclaration = node => Object.hasOwn(typeKinds, node.kind);
/** The texts of a modifier token list. */
export const words = tokens => tokens.map(token => token.text);
/** `{ start, end }` of a syntax node or token. */
export const spanOf = node => {
  const span = node.span;
  return { start: span.start, end: span.end };
};
/** Wraps a bare type; passes a TypeWithAnnotations through. */
export const twa = type => (type instanceof TypeWithAnnotations ? type : new TypeWithAnnotations(type));

/** The name parts of a (possibly qualified) namespace name: `A.B.C` gives ['A', 'B', 'C']. */
export function nameParts(name) {
  if (name.kind === 'QualifiedName') return [...nameParts(name.left), ...nameParts(name.right)];
  return [name.identifier.valueText];
}

/**
 * A class, struct, interface, enum or delegate declared in source: all partial declarations together.
 * Base types, interfaces and members are bound on first use through the owning source assembly.
 */
export class SourceTypeSymbol extends NamedTypeSymbol {
  constructor(assembly, init, declaration) {
    super(init);
    this.assembly = assembly;
    this.declarations = [declaration];
    this.syntax = declaration.syntax;
    this.isSource = true;
    this.isResolvingBase = false;
    this._nested = [];
    this._built = null;
    this._baseState = 0;
    this._declaredBase = undefined;
    this._declaredInterfaces = null;
  }

  get baseType() {
    this.assembly.resolveBases(this);
    return this._declaredBase ?? null;
  }

  get interfaces() {
    this.assembly.resolveBases(this);
    return this._declaredInterfaces ?? [];
  }

  getTypeMembers(name, arity) {
    return this._nested.filter(type => (name === undefined || type.name === name) && (arity === undefined || type.arity === arity));
  }

  getMembers(name) {
    this._built ??= this.assembly.buildMembers(this);
    return name === undefined ? this._built : this._built.filter(member => member.name === name);
  }

  addMember(member) {
    this.getMembers().push(member);
    member.containingSymbol = this;
    return member;
  }

  /** The scope members of one declaration are bound in: its file, namespaces, usings, containing types and this type. */
  scopeFor(declaration) {
    declaration.memberScope ??= declaration.scope.child('type', { type: this });
    return declaration.memberScope;
  }

  get primaryScope() {
    return this.scopeFor(this.declarations[0]);
  }

  get isPartial() {
    return this.declarations.some(declaration => words(declaration.syntax.modifiers).includes('partial'));
  }
}
