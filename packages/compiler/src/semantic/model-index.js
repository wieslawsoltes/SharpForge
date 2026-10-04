/**
 * The index a semantic model reads (SF-A02-T38): what the semantic analysis bound, findable by source span.
 *
 *   bound nodes     every bound expression and statement, keyed by the span of its syntax; nodes that share a span
 *                   (a conversion and its operand) are kept outermost first
 *   declarations    the symbol each declaration introduces: types, members, accessors, parameters, type parameters,
 *                   locals and local functions
 *   bodies          the bound body that contains a position, with the binder that bound it
 *
 * Nothing here binds: it only arranges the results of one analysis run.
 */
import { SymbolKind } from '../symbols/types.js';
import { walk } from '../bound/semantic-walker.js';

/** `{start, end}` of a syntax node, a token, a legacy tree node or a plain span. */
export function spanOf(node) {
  if (!node) return null;
  const span = node.span ?? node;
  return Number.isInteger(span.start) && Number.isInteger(span.end) ? { start: span.start, end: span.end } : null;
}

const keyOf = (uri, span) => uri + '|' + span.start + '|' + span.end;

/** The symbol a bound node refers to, or null: the node kinds are those of binder/body-binder.js. */
export function symbolOfBound(node) {
  switch (node?.kind) {
    case 'Local':
      return node.local;
    case 'Parameter':
      return node.parameter;
    case 'FieldAccess':
      return node.field;
    case 'PropertyAccess':
      return node.property;
    case 'IndexerAccess':
      return node.property ?? node.indexer ?? null;
    case 'EventAccess':
    case 'EventAssignment':
      return node.event;
    case 'Call':
      return node.method;
    case 'ObjectCreation':
      return node.constructor && typeof node.constructor === 'object' ? node.constructor : null;
    case 'DelegateCreation':
      return node.method ?? null;
    case 'TypeExpression':
      return node.referencedType;
    case 'NamespaceExpression':
      return node.namespace;
    case 'Binary':
    case 'Unary':
    case 'Increment':
    case 'CompoundAssignment':
    case 'UserDefinedCondition':
      return node.method ?? null;
    case 'Conversion':
      return node.conversion?.method ?? null;
    case 'DeclarationExpression':
      return node.local ?? null;
    default:
      return null;
  }
}

export class ModelIndex {
  /** @param analysis a `SemanticAnalysis.run()` result  @param {string} defaultUri the uri of the first file */
  constructor(analysis, defaultUri) {
    this.analysis = analysis;
    this.defaultUri = defaultUri;
    this.bound = new Map();
    /** The method a call's target names (`receiver.Method` in `receiver.Method(1)`): the group itself is not in the tree. */
    this.targets = new Map();
    this.declared = new Map();
    /** The span of the name of a member access -> the span of the access. */
    this.names = new Map();
    this.bodies = [];
    for (const [member, body] of analysis.bound) this.addBody(member, body);
    const seen = new Set();
    for (const type of analysis.assembly.types) this.addType(type, seen);
  }
  uriOf(node) {
    return node?.uri ?? this.defaultUri;
  }
  addBody(member, body) {
    const uri = body.binder?.c.uri ?? member.uri ?? member.locations?.[0]?.uri ?? this.defaultUri,
      span = spanOf(body.syntax);
    if (span) this.bodies.push({ member, body, uri, span });
    walk(body, node => {
      const at = spanOf(node.syntax);
      // The receiver of an unqualified member (`M()` for `this.M()`) is not written: it has no entry of its own.
      if (!at || ((node.kind === 'This' || node.kind === 'ImplicitReceiver') && node.isImplicit)) return;
      const key = keyOf(uri, at),
        list = this.bound.get(key);
      if (list) list.push(node);
      else this.bound.set(key, [node]);
      // A lambda declares its parameters once it is bound for a delegate type.
      if (node.kind === 'Lambda') for (const parameter of node.parameters ?? []) this.declare(uri, parameter.syntax, parameter);
      if (node.kind === 'Call' && node.method && node.syntax.kind === 'InvocationExpression') {
        const target = node.syntax.expression,
          name = target?.kind === 'SimpleMemberAccessExpression' ? target.name : null;
        for (const part of [target, name]) if (spanOf(part)) this.targets.set(keyOf(uri, spanOf(part)), node.method);
      }
      // The name part of `receiver.Member` means the member too (without the conversions applied to the access).
      const name = node.syntax.kind === 'SimpleMemberAccessExpression' ? spanOf(node.syntax.name) : null;
      if (name) this.names.set(keyOf(uri, name), key);
    });
    const binder = body.binder?.rootBinder ?? body.binder;
    for (const local of binder?.allLocals ?? body.locals ?? []) this.declareVariable(uri, local);
    for (const parameter of member.parameters ?? []) this.declare(uri, parameter.syntax, parameter);
  }
  /** A local is declared by its identifier and by the declarator, designation or statement the identifier belongs to. */
  declareVariable(uri, symbol) {
    this.declare(uri, symbol.syntax, symbol);
    if (symbol.syntax?.isToken) this.declare(uri, symbol.syntax.parent, symbol);
  }
  declare(uri, syntax, symbol) {
    const span = spanOf(syntax);
    if (span && !this.declared.has(keyOf(uri, span))) this.declared.set(keyOf(uri, span), symbol);
  }
  addType(type, seen) {
    if (seen.has(type) || !type.isSource) return;
    seen.add(type);
    for (const declaration of type.declarations ?? []) this.declare(declaration.uri, declaration.syntax, type);
    const uri = type.declarations?.[0]?.uri ?? this.defaultUri;
    for (const parameter of type.typeParameters ?? []) this.declare(uri, parameter.syntax, parameter);
    for (const member of type.getMembers()) this.addMember(member, uri);
    for (const nested of type.getTypeMembers?.() ?? []) this.addType(nested, seen);
  }
  addMember(member, typeUri) {
    if (member.isImplicitlyDeclared && !member.syntax) return;
    const uri = member.uri ?? member.locations?.[0]?.uri ?? typeUri;
    if (member.kind === SymbolKind.NamedType) return;
    this.declare(uri, member.syntax, member);
    for (const parameter of member.parameters ?? []) this.declare(uri, parameter.syntax, parameter);
    for (const parameter of member.typeParameters ?? []) this.declare(uri, parameter.syntax, parameter);
    for (const accessor of [member.getMethod, member.setMethod, member.addMethod, member.removeMethod]) {
      // An expression-bodied property has one syntax for the property and its getter: the property is declared there.
      if (accessor && accessor.syntax !== member.syntax) this.declare(uri, accessor.syntax, accessor);
    }
  }
  /** The bound nodes whose syntax has exactly this span, outermost first. */
  nodesAt(uri, span) {
    return this.bound.get(keyOf(uri, span)) ?? [];
  }
  /** The bound nodes of the member access whose name part has this span. */
  accessNamedAt(uri, span) {
    return this.bound.get(this.names.get(keyOf(uri, span))) ?? [];
  }
  declaredAt(uri, span) {
    return this.declared.get(keyOf(uri, span)) ?? null;
  }
  /** The innermost bound body that contains a position: `{member, body, uri, span}` or null. */
  bodyAt(uri, position) {
    let best = null;
    for (const entry of this.bodies) {
      if (entry.uri !== uri || position < entry.span.start || position > entry.span.end) continue;
      if (!best || entry.span.end - entry.span.start <= best.span.end - best.span.start) best = entry;
    }
    return best;
  }
}

/** The syntax nodes of a tree whose span is exactly `span`, outermost first. */
export function syntaxNodesAt(root, span) {
  const found = [];
  let node = root;
  while (node) {
    const own = node.span;
    if (own.start === span.start && own.end === span.end) found.push(node);
    node = node.childNodes().find(child => child.fullSpan.start <= span.start && span.end <= child.fullSpan.end) ?? null;
  }
  return found;
}
