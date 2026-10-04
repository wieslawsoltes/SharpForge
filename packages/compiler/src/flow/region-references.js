/**
 * The variable references of a method body for region analysis (SF-A02-T35): every read and write of a local or
 * parameter with its position, the function it occurs in, and what each lambda and local function captures.
 *
 * A reference is `{variable, kind: 'read'|'write', span, node}`. As in Roslyn's region analysis:
 *   - the target of `x = e` is written, of `x += e`, `x++` and `x ??= e` read and written; an `out` argument is
 *     written, a `ref` argument read and written; a declaration with a value, a foreach variable, a pattern or `out`
 *     variable and the parameters of a lambda or local function are written where they are declared;
 *   - a variable used in a lambda or local function other than the one that declares it is captured there;
 *   - a call of a local function (or its conversion to a delegate) reads and writes what the function captures, at
 *     the call: the function's body runs when it is called, not where it is written.
 */
import { forEachChild } from '../bound/semantic-walker.js';
import { RefKind } from '../symbols/types.js';

/** The span of the syntax a bound node was bound from, or null. */
export function spanOfNode(node) {
  const syntax = node?.syntax,
    span = syntax?.span ?? syntax;
  return span && Number.isInteger(span.start) && Number.isInteger(span.end) ? { start: span.start, end: span.end } : null;
}

const variableOf = node => (node?.kind === 'Local' ? node.local : node?.kind === 'Parameter' ? node.parameter : null);
const readWriteKinds = new Set(['CompoundAssignment', 'Increment', 'CoalesceAssignment']);
const writeKinds = new Set(['Assignment', 'RefAssignment', 'DeconstructionAssignment']);

/** The variables an assignment target stores into: a variable, or the elements of a tuple of targets. */
function targetNodes(target, out = []) {
  if (!target) return out;
  if (target.kind === 'Tuple') for (const element of target.elements ?? []) targetNodes(element, out);
  else if (variableOf(target)) out.push(target);
  return out;
}

class ReferenceCollector {
  constructor() {
    this.references = [];
    /** variable -> the function (bound Lambda node, local function symbol or null for the method) that declares it */
    this.owners = new Map();
    /** captured uses: `{variable, span}` */
    this.captures = [];
    /** function -> `{reads: Set, writes: Set, calls: Set}` of what it captures and which local functions it calls */
    this.usage = new Map();
    /** call sites of local functions: `{method, span, node, owner}` */
    this.calls = [];
    this.targets = new Map();
  }

  declare(variable, owner, span, node, isWritten) {
    if (!variable) return;
    if (!this.owners.has(variable)) this.owners.set(variable, owner);
    if (isWritten) this.note(variable, 'write', span, node, owner);
  }

  note(variable, kind, span, node, owner) {
    this.references.push({ variable, kind, span, node });
    const declaredIn = this.owners.get(variable);
    if (declaredIn === undefined || declaredIn === owner) return;
    this.captures.push({ variable, span });
    // Every function between the use and the declaration captures the variable.
    for (let current = owner; current && current !== declaredIn; current = this.parents.get(current) ?? null) {
      this.usageOf(current)[kind === 'read' ? 'reads' : 'writes'].add(variable);
    }
  }

  usageOf(owner) {
    let usage = this.usage.get(owner);
    if (!usage) this.usage.set(owner, (usage = { reads: new Set(), writes: new Set(), calls: new Set() }));
    return usage;
  }

  /** Collects the declarations of a function body first, so that a use before the declaration knows its owner. */
  collect(body, parameters) {
    this.parents = new Map();
    this.declarations(body, null);
    for (const parameter of parameters) this.owners.set(parameter, null);
    this.visit(body, null);
  }

  declarations(node, owner) {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'Lambda') {
      this.parents.set(node, owner);
      for (const parameter of node.parameters ?? []) this.owners.set(parameter, node);
      if (node.body) this.declarations(node.body, node);
      return;
    }
    if (node.kind === 'LocalFunction' && node.method) {
      this.parents.set(node.method, owner);
      for (const parameter of node.method.parameters ?? []) this.owners.set(parameter, node.method);
      if (node.method.body) this.declarations(node.method.body, node.method);
      return;
    }
    for (const local of this.introducedBy(node)) if (!this.owners.has(local)) this.owners.set(local, owner);
    forEachChild(node, child => this.declarations(child, owner));
  }

  /** The locals a node declares: declarators, a foreach, pattern, catch or `out` variable. */
  introducedBy(node) {
    const locals = [];
    if (node.kind !== 'Local' && node.local) locals.push(node.local);
    for (const declaration of node.declarations ?? node.declaration ?? []) if (declaration.local) locals.push(declaration.local);
    if (Array.isArray(node.resources)) for (const resource of node.resources) if (resource.local) locals.push(resource.local);
    for (const clause of node.catches ?? []) if (clause.local) locals.push(clause.local);
    return locals;
  }

  visit(node, owner) {
    if (!node || typeof node !== 'object') return;
    const span = spanOfNode(node);
    switch (node.kind) {
      case 'Lambda':
        for (const parameter of node.parameters ?? []) this.note(parameter, 'write', spanOfNode({ syntax: parameter.syntax }) ?? span, node, node);
        if (node.body) this.visit(node.body, node);
        return;
      case 'LocalFunction': {
        const method = node.method;
        for (const parameter of method?.parameters ?? []) this.note(parameter, 'write', spanOfNode({ syntax: parameter.syntax }) ?? span, node, method);
        if (method?.body) this.visit(method.body, method);
        return;
      }
      case 'Local':
      case 'Parameter': {
        const role = this.targets.get(node) ?? 'read';
        if (role !== 'write') this.note(variableOf(node), 'read', span, node, owner);
        if (role !== 'read') this.note(variableOf(node), 'write', span, node, owner);
        return;
      }
      default:
        break;
    }
    if (writeKinds.has(node.kind)) for (const target of targetNodes(node.left)) this.targets.set(target, 'write');
    if (readWriteKinds.has(node.kind)) for (const target of targetNodes(node.left ?? node.operand)) this.targets.set(target, 'readWrite');
    for (const argument of node.args ?? []) {
      const value = argument.expression ?? argument;
      if (argument.refKind === RefKind.Out) for (const target of targetNodes(value)) this.targets.set(target, 'write');
      if (argument.refKind === RefKind.Ref) for (const target of targetNodes(value)) this.targets.set(target, 'readWrite');
    }
    this.noteDeclarations(node, owner, span);
    this.noteLocalFunctionUse(node, owner, span);
    forEachChild(node, child => this.visit(child, owner));
  }

  /** Locals a node declares and writes: `int x = e;`, a foreach, pattern, catch or `out` variable. */
  noteDeclarations(node, owner, span) {
    const at = local => spanOfNode({ syntax: local.syntax }) ?? span;
    if (node.kind !== 'Local' && node.local) this.note(node.local, 'write', at(node.local), node, owner);
    const declarators = [...(node.declarations ?? node.declaration ?? []), ...(Array.isArray(node.resources) ? node.resources : [])];
    for (const { local, value } of declarators) if (local && value) this.note(local, 'write', at(local), node, owner);
    for (const clause of node.catches ?? []) if (clause.local) this.note(clause.local, 'write', at(clause.local), node, owner);
  }

  /** A call of a local function, or a method group that names one. */
  noteLocalFunctionUse(node, owner, span) {
    const methods = node.kind === 'Call' && node.method ? [node.method] : node.kind === 'MethodGroup' ? (node.methods ?? []) : [];
    for (const method of methods) {
      const definition = method.originalDefinition ?? method;
      if (!this.parents.has(definition)) continue;
      this.calls.push({ method: definition, span, node, owner });
      if (owner) this.usageOf(owner).calls.add(definition);
    }
  }

  /** What calling `method` reads and writes outside itself, through the local functions it calls as well. */
  effectsOf(method, seen = new Set()) {
    const reads = new Set(),
      writes = new Set();
    const add = current => {
      if (seen.has(current)) return;
      seen.add(current);
      const usage = this.usage.get(current);
      if (!usage) return;
      for (const variable of usage.reads) reads.add(variable);
      for (const variable of usage.writes) writes.add(variable);
      for (const callee of usage.calls) add(callee);
    };
    add(method);
    return { reads, writes };
  }
}

/**
 * @param body the bound body of a method (binder/body-binder.js)  @param {object[]} parameters its parameter symbols
 * @returns {{references: object[], captures: object[], owners: Map, effectsOf: (function: object) => {reads: Set, writes: Set},
 *   isLocalFunction: (method: object) => boolean}} `references` includes the reads and writes of local function calls
 */
export function collectReferences(body, parameters = []) {
  const collector = new ReferenceCollector();
  collector.collect(body, parameters);
  for (const call of collector.calls) {
    const effects = collector.effectsOf(call.method);
    for (const variable of effects.reads) collector.references.push({ variable, kind: 'read', span: call.span, node: call.node });
    for (const variable of effects.writes) collector.references.push({ variable, kind: 'write', span: call.span, node: call.node });
  }
  return {
    references: collector.references,
    captures: collector.captures,
    owners: collector.owners,
    effectsOf: owner => collector.effectsOf(owner),
    isLocalFunction: method => collector.parents.has(method?.originalDefinition ?? method),
  };
}
