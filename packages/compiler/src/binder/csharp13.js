/**
 * Attribute-driven rules of C# 13 (SF-A02-E11), run once the attributes are bound.
 *
 *   OverloadResolutionPriorityAttribute (SF-A02-T81): overload resolution reads the priority from the bound
 *   attribute (overload/params-collections.js `overloadPriority`). Here its placement is checked like Roslyn:
 *   CS9261 on an overriding member (the priority of the overridden member applies), CS9262 where it has no
 *   meaning: a property that is not an indexer, a static constructor, a destructor, a conversion operator and an
 *   explicit interface implementation.
 *
 * Below C# 13 the attribute itself is the gated construct (CS9202 and its siblings, on the attribute).
 *
 *   Ref locals in iterators and async methods (SF-A02-T82): `refLocalsAcrossSuspensions`, CS9217; ref struct
 *   locals read after a suspension: ./ref-struct-suspensions.js, CS4007.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, RefKind } from '../symbols/types.js';
import { forEachChild } from '../bound/semantic-walker.js';
import { MethodKind } from '../symbols/members.js';
import { attributesNamed } from './bound-attributes.js';
import { overloadPriorityAttribute } from '../overload/params-collections.js';
import { refStructLocalsAcrossSuspensions } from './ref-struct-suspensions.js';
import { refAndUnsafeInAsyncFeature } from './ref-struct.js';

/** The diagnostic code for the attribute on `member`, or null when it is allowed there. */
function priorityPlacementProblem(member) {
  if (member.isOverride) return DiagnosticId.CS9261;
  if (member.explicitInterfaceSyntax) return DiagnosticId.CS9262;
  if (member.kind === SymbolKind.Property) return member.isIndexer ? null : DiagnosticId.CS9262;
  if (member.kind !== SymbolKind.Method) return null;
  return [MethodKind.StaticConstructor, MethodKind.Destructor, MethodKind.Conversion].includes(member.methodKind) ? DiagnosticId.CS9262 : null;
}

const unsafeSyntaxKinds = new Set(['PointerType', 'AddressOfExpression']);
const functionSyntaxKinds = new Set(['ParenthesizedLambdaExpression', 'SimpleLambdaExpression', 'AnonymousMethodExpression', 'LocalFunctionStatement']);
const loopKinds = new Set(['WhileStatement', 'DoStatement', 'ForStatement', 'ForEachStatement', 'ForEachVariableStatement']);
const spanOf = node => node.span ?? node;
const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;

/** The span of the block (or embedded statement) a local declared at `syntax` is in scope of. */
function scopeOf(syntax) {
  for (let node = syntax?.parent; node; node = node.parent) if (node.kind === 'Block' || node.kind === 'SwitchSection') return spanOf(node);
  return null;
}

/**
 * C# 13 lets an iterator or async method declare ref locals, but a ref local does not survive a `yield` or an
 * `await`: using it afterwards is CS9217, reported on the use (SF-A02-T82).
 *
 * A use is after a suspension when a `yield return` / `await` inside the local's scope comes before it in the text
 * (with no ref re-assignment of the local in between), or when both are inside one loop that the local was declared
 * outside of. Lambdas and local functions inside the body are not looked into.
 * @returns {{node: object, code: string, args: any[]}[]}
 */
export function refLocalsAcrossSuspensions(body) {
  const suspensions = [],
    uses = [],
    reassignments = [];
  const visit = node => {
    if (node.kind === 'Lambda' || node.kind === 'LocalFunction') return;
    if (node.kind === 'Await' || node.kind === 'YieldReturn') suspensions.push(spanOf(node.syntax));
    if (node.kind === 'RefAssignment' && node.left?.kind === 'Local') {
      // `r = ref y` binds the local again: its left side is not a use of the old reference.
      reassignments.push({ local: node.left.local, span: spanOf(node.syntax) });
      visit(node.right);
      return;
    }
    if (node.kind === 'Local' && node.local?.refKind && node.local.refKind !== RefKind.None) uses.push(node);
    forEachChild(node, visit);
  };
  visit(body);
  if (!suspensions.length || !uses.length) return [];
  const rows = [];
  for (const use of uses) {
    const declaration = use.local.syntax ?? use.local.locations?.[0],
      scope = scopeOf(use.local.syntax),
      at = spanOf(use.syntax);
    if (!scope || !declaration) continue;
    const declared = spanOf(declaration).start,
      // The local is (re)bound by its declaration and by every `r = ref ...` before the use.
      bound = Math.max(declared, ...reassignments.filter(r => r.local === use.local && r.span.end <= at.start).map(r => r.span.end));
    let crossed = suspensions.some(s => contains(scope, s) && s.start >= bound && s.end <= at.start);
    for (let node = use.syntax.parent; node && !crossed; node = node.parent) {
      const loop = loopKinds.has(node.kind) ? spanOf(node) : null;
      // A loop inside the local's scope that the local was declared outside of: its back edge carries the suspension.
      if (loop && contains(scope, loop) && !(loop.start <= declared && declared < loop.end)) crossed = suspensions.some(s => contains(loop, s));
    }
    if (crossed) rows.push({ node: use.syntax, code: DiagnosticId.CS9217, args: [] });
  }
  return rows;
}

/** Class mixin (analysis phase): the attribute-driven rules of C# 13. */
export const CSharp13Rules = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      for (const type of this.assembly.types)
        for (const member of type.getMembers()) {
          const attribute = attributesNamed(member, overloadPriorityAttribute)[0];
          if (!attribute) continue;
          const uri = member.uri ?? member.locations?.[0]?.uri ?? this.files[0]?.source.uri;
          if (!this.gate(uri, attribute.syntax, 'OverloadResolutionPriority', { name: 'overload resolution priority', version: 13 })) continue;
          const code = priorityPlacementProblem(member);
          if (code) this.report(uri, attribute.syntax, code);
        }
    }
  };

/** Class mixin (analysis phase, composed after body binding): the rules of C# 13 that need bound bodies. */
export const CSharp13BodyRules = Base =>
  class extends Base {
    bindMethodBody(method, context) {
      const body = super.bindMethodBody(method, context);
      if (!body || context.parent || !(method.isAsync || body.binder?.c?.isIterator)) return body;
      // Below C# 13 the declaration of the ref local is the error (the feature gate); the rule is not applied.
      if (this.versionOf(context.uri).number >= 13)
        for (const row of refLocalsAcrossSuspensions(body)) this.report(context.uri, row.node, row.code, row.args);
      else if (body.binder?.c?.isIterator) this.gateUnsafeIterator(method, context.uri);
      for (const row of refStructLocalsAcrossSuspensions(body)) (this.acrossSuspensions ??= []).push({ uri: context.uri, ...row });
      // `&local` in an iterator (./unsafe-iterators.js).
      if (body.binder?.c?.isIterator) for (const operand of body.binder.addressOfLocals ?? []) this.report(context.uri, operand, DiagnosticId.CS9239);
      return body;
    }
    /** Below C# 13 unsafe code in an iterator is the gated feature: an `unsafe` iterator, pointer types and `&` in its body. */
    gateUnsafeIterator(method, uri) {
      const gate = node => this.gate(uri, node, 'RefUnsafeInIteratorAsync', refAndUnsafeInAsyncFeature),
        declaration = method.syntax;
      if ((declaration?.modifiers ?? []).some(token => token.text === 'unsafe') && declaration.identifier) gate(declaration.identifier);
      const stack = [declaration?.body ?? declaration?.expressionBody].filter(Boolean);
      while (stack.length) {
        const node = stack.pop();
        if (unsafeSyntaxKinds.has(node.kind)) gate(node);
        if (!functionSyntaxKinds.has(node.kind)) stack.push(...node.childNodes());
      }
    }
    bindBodies() {
      super.bindBodies();
      // Roslyn finds CS4007 while it builds the state machine, which it does only for a program without errors.
      if (this.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return;
      for (const row of this.acrossSuspensions ?? []) this.report(row.uri, row.node, row.code, row.args);
    }
  };
