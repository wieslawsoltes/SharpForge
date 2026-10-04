/**
 * Walks one bound body for ref safety: declares locals with the scope they live in, and asks the escape checks at
 * every place a value or reference moves: returns, assignments, ref assignments, calls and ref conditionals.
 * Lambda bodies are not entered (their returns belong to the delegate signature); local functions are analysed as
 * methods of their own that share the enclosing locals.
 */
import { isRefLike } from '../../binder/ref-struct.js';
import { EscapeScope } from './contexts.js';
import { isByReference } from './symbols.js';

const skippedKeys = new Set(['syntax', 'type', 'binder', 'locals', 'conversion', 'argumentSyntax', 'mapping', 'loop']);
const invocationKinds = new Set(['Call', 'ObjectCreation', 'IndexerAccess']);
// Bound nodes and their argument / declaration entries are object literals; symbols and syntax nodes are class instances.
const literalParent = Object.getPrototypeOf({});
const isPlainObject = value => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === literalParent;

export class RefSafetyWalker {
  /**
   * @param safety the escape contexts and checks for the method (flow/ref-safety.js `RefSafety`)
   * @param {(method: object, locals: Map) => object} createNested builds the checks for a local function
   */
  constructor(safety, createNested) {
    this.safety = safety;
    this.createNested = createNested;
    this.problems = [];
    this.depth = -1;
    this.visited = new Set();
  }
  /** @returns {{ node: object, code: string, args: any[] }[]} */
  run(body) {
    this.visit(body);
    return this.problems;
  }
  add(problems) {
    this.problems.push(...problems);
  }
  visit(node) {
    if (Array.isArray(node)) {
      for (const item of node) this.visit(item);
      return;
    }
    if (!isPlainObject(node) || this.visited.has(node)) return;
    this.visited.add(node);
    if (typeof node.kind !== 'string') {
      this.children(node);
      return;
    }
    switch (node.kind) {
      case 'Block':
      case 'For':
      case 'ForEach':
      case 'Using':
      case 'Fixed':
        this.depth++;
        this.scopeStatement(node);
        this.depth--;
        return;
      case 'LocalDeclaration':
        this.declarations(node.declarations);
        return;
      case 'Return':
        this.children(node);
        if (node.expression && !node.expression.hasErrors) this.returned(node.expression, node.isRef === true);
        return;
      case 'ExpressionBody':
        this.children(node);
        if (node.isReturn && node.expression && !node.expression.hasErrors) this.returned(node.expression, node.expression.kind === 'Ref');
        return;
      case 'LocalFunction':
        if (node.method?.body) this.add(new RefSafetyWalker(this.createNested(node.method, this.safety.locals), this.createNested).run(node.method.body));
        return;
      case 'Lambda':
        return;
      case 'Assignment':
        this.children(node);
        if (!node.hasErrors) this.add(this.safety.assignmentProblems(node.left, node.right));
        return;
      case 'RefAssignment':
        this.children(node);
        this.add(this.safety.refAssignmentProblems(node));
        return;
      case 'RefConditional':
        this.children(node);
        this.add(this.safety.refConditionalProblems(node));
        return;
      default:
        this.children(node);
        if (invocationKinds.has(node.kind)) this.invocation(node);
    }
  }
  children(node) {
    for (const key of Object.keys(node)) {
      if (!skippedKeys.has(key)) this.visit(node[key]);
    }
  }
  scopeStatement(node) {
    if (node.kind === 'For' && node.declaration) this.declarations(node.declaration);
    if (node.kind === 'Fixed' && node.declaration) this.declarations(node.declaration);
    if (node.kind === 'Using' && Array.isArray(node.resources)) this.declarations(node.resources.filter(resource => resource?.local));
    if (node.kind === 'ForEach' && node.local) {
      this.visit(node.collection);
      this.declare(node.local, null);
      const entry = this.safety.locals.get(node.local);
      if (entry && isByReference(node.local.refKind) && !entry.scoped) entry.refSafe = this.safety.iterationRefSafe(node.collection, entry.scope);
    }
    this.children(node);
  }
  declarations(list) {
    for (const declaration of list ?? []) {
      if (!declaration?.local) {
        this.visit(declaration);
        continue;
      }
      this.visit(declaration.value);
      this.declare(declaration.local, declaration.value);
    }
  }
  declare(local, value) {
    const initializer = value && !value.hasErrors ? value : null;
    this.safety.declareLocal(local, Math.max(this.depth, 0), { scoped: local.isScoped === true });
    this.safety.initializeLocal(local, initializer, { isRef: isByReference(local.refKind) });
  }
  returned(expression, isRef) {
    if (isRef) this.add(this.safety.refEscapeProblems(expression, EscapeScope.ReturnOnly));
    else this.add(this.safety.valueEscapeProblems(expression, EscapeScope.ReturnOnly));
  }
  invocation(node) {
    this.add(this.safety.argumentMixingProblems(node));
    // `out var s` of a ref struct type: the new local is as narrow as anything the call was given.
    for (const entry of node.args ?? []) {
      const argument = entry.expression ?? entry;
      if (argument.kind !== 'DeclarationExpression' || !argument.local || !isRefLike(argument.local.type)) continue;
      this.safety.declareLocal(argument.local, Math.max(this.depth, 0));
      this.safety.locals.get(argument.local).safe = this.safety.invocationContext(node);
    }
  }
}
