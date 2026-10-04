/**
 * Scope queries of the semantic model over the semantic analysis (SF-A02-T38): what is visible at a position, and
 * binding an expression that is not in the source as if it were written there.
 *
 * A local is visible from its declaration to the end of the block (or loop, using, switch section, lambda) that
 * declares it. After the locals come the parameters, the members of the enclosing types with those they inherit, and
 * the types and namespaces of the enclosing namespaces and of their using directives.
 */
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { SymbolKind } from '../symbols/types.js';
import { BodyBinder } from '../binder/body-binder.js';
import { lookupMembers } from '../binder/inheritance.js';
import { symbolOfBound } from './model-index.js';

const scopeKinds = new Set([
  'Block',
  'ForStatement',
  'ForEachStatement',
  'ForEachVariableStatement',
  'UsingStatement',
  'FixedStatement',
  'SwitchSection',
  'SwitchExpressionArm',
  'CatchClause',
  'ParenthesizedLambdaExpression',
  'SimpleLambdaExpression',
  'AnonymousMethodExpression',
  'CompilationUnit',
]);
const noConstant = Object.freeze({ hasValue: false, value: undefined });
const isTypeLike = symbol => [SymbolKind.NamedType, SymbolKind.Namespace, SymbolKind.TypeParameter, SymbolKind.Alias].includes(symbol.kind);

/** The span in which a local is in scope: the nearest enclosing scope-forming syntax of its declaration. */
function scopeSpanOf(local) {
  for (let node = local.syntax?.parent; node; node = node.parent) if (scopeKinds.has(node.kind)) return node.span;
  return null;
}

/** Class mixin: lookupSymbols and speculative binding. */
export const ScopeQueries = Base =>
  class extends Base {
    /** The locals and parameters visible at a position of a bound body, innermost declaration first. */
    variablesAt(entry, position) {
      const binder = entry.body.binder?.rootBinder ?? entry.body.binder,
        locals = (binder?.allLocals ?? entry.body.locals ?? []).filter(local => {
          const declared = local.locations?.[0]?.start ?? local.syntax?.span?.start ?? 0,
            scope = scopeSpanOf(local);
          return !local.isCompilerGenerated && declared <= position && (!scope || (scope.start <= position && position <= scope.end));
        });
      return [...locals.reverse(), ...(entry.member.parameters ?? []).filter(parameter => parameter.name)];
    }
    /** The members a simple name can reach from inside `type`: its own, inherited ones and those of enclosing types. */
    membersVisibleIn(type) {
      const members = [],
        seen = new Set();
      for (let outer = type; outer; outer = outer.containingType) {
        for (let current = outer, depth = 0; current && depth < 64; current = current.baseType, depth++) {
          for (const member of current.getMembers()) {
            const isNamed = member.name && !member.isImplicitlyDeclared && !(member.kind === SymbolKind.Method && (member.isAccessor || member.isConstructor));
            if (isNamed && !seen.has(member)) members.push(member);
            seen.add(member);
          }
          for (const nested of current.getTypeMembers?.() ?? []) if (!seen.has(nested)) members.push(nested);
        }
      }
      return members;
    }
    /** The types and namespaces the namespace scopes at a position make visible by simple name. */
    typesVisibleIn(scope) {
      const symbols = [];
      for (let current = scope; current; current = current.parent) {
        if (current.kind === 'typeParameters') symbols.push(...current.parameters);
        if (current.kind !== 'namespace' && current.kind !== 'unit') continue;
        symbols.push(...(current.namespace?.getMembers() ?? []));
        const usings = current.usings ? this.driver.typeBinder.usingsOf(current) : null;
        for (const alias of usings?.aliases?.values() ?? []) symbols.push(alias);
        for (const namespace of usings?.namespaces ?? []) symbols.push(...namespace.getTypeMembers());
      }
      return symbols;
    }
    /**
     * The symbols visible at a position, innermost scope first; with `name`, only the symbols of that name.
     * @param {number} position  @param {{uri?:string, name?:string, namespacesAndTypesOnly?:boolean}} [options]
     */
    lookupSymbols(position, { uri = this.defaultUri, name, namespacesAndTypesOnly = false } = {}) {
      const entry = this.index.bodyAt(uri, position),
        scope = this.typeScopeAt(uri, position),
        type = entry?.member.containingType ?? scope?.containingType ?? null,
        symbols = [];
      if (!namespacesAndTypesOnly) {
        if (entry) symbols.push(...this.variablesAt(entry, position));
        if (type) symbols.push(...this.membersVisibleIn(type));
      } else if (type) symbols.push(...this.membersVisibleIn(type).filter(isTypeLike));
      if (scope) symbols.push(...this.typesVisibleIn(scope));
      const visible = [],
        names = new Map();
      for (const symbol of symbols) {
        // An inner declaration hides an outer one of the same name, except that methods overload.
        const hiding = names.get(symbol.name);
        if (hiding && !(hiding.kind === SymbolKind.Method && symbol.kind === SymbolKind.Method)) continue;
        if (!hiding) names.set(symbol.name, symbol);
        if (!visible.includes(symbol)) visible.push(symbol);
      }
      if (name === 'this' && entry && !entry.member.isStatic && type && !namespacesAndTypesOnly) return [type];
      return name === undefined ? visible : visible.filter(symbol => symbol.name === name);
    }
    /**
     * Binds an expression that is not part of the source as if it were written at `position`.
     * @param {string} text the expression
     * @returns `{bound, type, symbol, constantValue, diagnostics:[{code,args}]}`; the analysis is not changed
     */
    bindSpeculativeExpression(position, text, { uri = this.defaultUri } = {}) {
      const entry = this.index.bodyAt(uri, position),
        diagnostics = [];
      const unbound = { bound: null, type: null, symbol: null, constantValue: noConstant };
      if (!entry?.body.binder) return { ...unbound, diagnostics: [{ code: 'CS0103', args: [String(text)] }] };
      const wrapper = `class __Speculative { object __Value() => ${text}\n; }`,
        parsed = parse(new SourceText(wrapper, uri)),
        syntax = parsed.syntax.members?.[0]?.members?.[0]?.expressionBody?.expression;
      for (const d of parsed.diagnostics) diagnostics.push({ code: d.code, args: [], message: d.message });
      if (!syntax) return { ...unbound, diagnostics };
      // A shadow of the analysis: what the binder reports or records goes to this query, not into the analysis.
      const shadow = Object.create(this.driver);
      shadow.report = (_uri, _node, code, args = []) => void diagnostics.push({ code, args });
      shadow.noteUse = () => {};
      shadow.gate = () => true;
      shadow.incomplete = false;
      const original = entry.body.binder.c,
        outerLocals = this.variablesAt(entry, position)
          .filter(symbol => symbol.kind === SymbolKind.Local)
          .map(local => [local.name, local]);
      const binder = new BodyBinder(shadow, { ...original, parent: null, parameters: entry.member.parameters ?? original.parameters, outerLocals });
      const bound = binder.asValue(binder.expression(syntax)),
        constant = bound.constantValue;
      return {
        bound,
        type: bound.type ?? null,
        symbol: symbolOfBound(bound),
        constantValue: constant ? { hasValue: true, value: constant.value } : noConstant,
        diagnostics,
      };
    }
    /** The type of a speculative expression (see bindSpeculativeExpression). */
    getSpeculativeTypeInfo(position, text, options) {
      const { type } = this.bindSpeculativeExpression(position, text, options);
      return { type, convertedType: type };
    }
    /** The symbols a name binds to among members of a type, by the member lookup rules (hiding, accessibility). */
    lookupMembers(type, name, { within = type } = {}) {
      return lookupMembers(type, name, this.core, { within }).members;
    }
  };
