/**
 * Extension indexer access (SF-A02-T91). PROVISIONAL: C# 15 preview, after
 * csharplang/proposals/csharp-15.0/extension-indexers.md revision 1 (packages/syntax/src/preview-revisions.js). The
 * pinned Roslyn parses the declaration but rejects it (CS9282), so there is no Roslyn fixture for any of this.
 *
 * "Indexer access": an element access is bound as an extension indexer access only when the normal processing finds
 * no applicable indexer (instance indexers first, then the implicit Index / Range forms). "Extension indexer access":
 *
 *   - never for a `base` receiver, and never for arrays and strings (their element access is not an indexer access;
 *     "no extension indexers on strings or arrays", decision recorded in the proposal);
 *   - the scopes of extension method lookup are walked innermost first; in each scope the accessible indexers that
 *     are applicable to the receiver followed by the arguments are the candidates, and the first scope that has one
 *     decides by overload resolution (an ambiguity is an error: CS9339, the diagnostic of an ambiguous extension);
 *   - the type arguments of the block are inferred from the receiver and the arguments only;
 *   - the access is the call of the static `get_Item` / `set_Item` implementation with the receiver first.
 *
 *   - "Extension indexers cannot be captured in expression trees": SF2203 (the proposal names no diagnostic id).
 *
 * The bound node is an `IndexerAccess` whose property carries the constructed accessors, so assignment, compound
 * assignment and the null-conditional and initializer forms need nothing of their own.
 *
 * Not bound (reported with SF2202, never guessed):
 *   - "Extension implicit indexer access" (an Index or Range argument through an extension `Length` / `Count` and
 *     `this[int]` / `Slice`): the proposal's lookup order for it changed between its text and its recorded decisions;
 *   - an extension indexer on a framework type whose own indexers the framework registry may not list completely:
 *     an instance indexer the registry lacks would have to win, and that cannot be decided here.
 * A write-only extension indexer is not found (the candidates are matched through the get accessor), as for
 * extension properties. List patterns do not look for extension indexers.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { ArrayTypeSymbol, SymbolKind, TypeKind } from '../symbols/types.js';
import { PropertySymbol } from '../symbols/members.js';
import { isValidReceiverConversion } from '../overload/extension-methods.js';
import { numericKind } from '../conversions/numeric.js';
import { isAccessible } from './accessibility.js';
import { isSourceSymbol } from '../semantic/analysis-helpers.js';
import { indexOrRangeKind } from './index-range.js';
import { walk } from '../bound/semantic-walker.js';
import { expressionTreeDelegate } from '../symbols/expression-tree-types.js';

const indexerName = 'this[]';

/** The indexer over the accessors constructed for this access (the block's type arguments are known at the use). */
function constructedIndexer(definition, getMethod, setMethod) {
  const property = new PropertySymbol({
    name: definition.name,
    type: getMethod.returnTypeWithAnnotations,
    containingSymbol: definition.containingSymbol,
    declaredAccessibility: definition.declaredAccessibility,
    modifiers: definition.modifiers,
    locations: definition.locations,
    syntax: definition.syntax,
  });
  property._original = definition;
  property.getMethod = getMethod;
  property.setMethod = setMethod;
  property.isExtensionProperty = true;
  property.isExtensionIndexer = true;
  property.extensionReceiverType = getMethod.parameters[0].type;
  property.parameters = Object.freeze(getMethod.parameters.slice(1));
  return property;
}

/** Binder mixin: element access through an extension indexer. */
export const ExtensionIndexerBinding = Base =>
  class extends Base {
    elementAccessOn(target, args, syntax) {
      const type = target.type;
      // Arrays and strings have element access of their own; `base` never reaches extension members.
      if (!type || target.kind === 'Base' || type instanceof ArrayTypeSymbol || type.specialType === 'System_String')
        return super.elementAccessOn(target, args, syntax);
      if (target.hasErrors || args.some(argument => argument.hasErrors)) return super.elementAccessOn(target, args, syntax);
      const scopes = this.extensionMemberScopes(indexerName, 'instance');
      if (!scopes.length) return super.elementAccessOn(target, args, syntax);
      // The normal processing first; what it reports is kept back until the extension lookup has had its turn.
      const saved = this.quiet,
        collected = [],
        wasIncomplete = [this.incomplete, this.d.incomplete];
      this.quiet = collected;
      let normal;
      try {
        normal = super.elementAccessOn(target, args, syntax);
      } finally {
        this.quiet = saved;
      }
      const replay = () => {
        for (const row of collected) this.report(row.node, row.code, row.args);
        return normal;
      };
      if (!normal.hasErrors) return replay();
      const notBound = what => {
        this.report(syntax, DiagnosticId.SF2202, [what, previewStampText('ExtensionIndexers')]);
        return this.bad(syntax);
      };
      const found = this.extensionIndexerAccess(scopes, target, args, syntax);
      if (!found) {
        const isImplicitForm = args.length === 1 && !!indexOrRangeKind(args[0].type, this.core);
        if (isImplicitForm && this.hasExtensionIndexerTakingInt(scopes, target, args[0]))
          return notBound('extension implicit indexer access (an Index or Range argument)');
        return replay();
      }
      // No diagnostic from the normal processing: the type is a framework type whose indexers may be incomplete.
      if (!collected.length && !this.hasNoUnlistedIndexers(type))
        return notBound('extension indexers on a framework type whose indexers the registry may not list');
      [this.incomplete, this.d.incomplete] = wasIncomplete;
      return found.node ?? this.bad(syntax);
    }
    /** True when an extension `this[int]` applies to the receiver: the part an implicit Index / Range access would use. */
    hasExtensionIndexerTakingInt(scopes, target, argument) {
      const combined = [{ ...target, name: null, refKind: null }, this.placeholder(argument.syntax, this.core.int)];
      const indexers = scopes.flat().map(entry => entry.symbol);
      return indexers.some(indexer => indexer.isExtensionIndexer && indexer.getMethod && this.isApplicableExtensionIndexer(indexer, combined));
    }
    /** "Extension indexers cannot be captured in expression trees." */
    finishLambda(lambda, delegateType) {
      const first = !lambda.finished;
      super.finishLambda(lambda, delegateType);
      if (!first || !lambda.body || !expressionTreeDelegate(delegateType, this.core)) return;
      walk(lambda.body, node => {
        if (node.kind === 'IndexerAccess' && node.property?.isExtensionIndexer)
          this.report(node.syntax, DiagnosticId.SF2203, ['an extension indexer cannot be captured in an expression tree', previewStampText('ExtensionIndexers')]);
        return !node.hasErrors;
      });
    }
    /** Types that are known to declare no indexer beyond those the binder sees: source types, type parameters, simple types. */
    hasNoUnlistedIndexers(type) {
      if (isSourceSymbol(type) || type.typeKind === TypeKind.TypeParameter || type.typeKind === TypeKind.Enum) return true;
      return !!numericKind(type) || ['System_Boolean', 'System_Char', 'System_Object'].includes(type.specialType);
    }
    /**
     * The access through the extension indexer of the nearest scope that has an applicable one.
     * @returns {null|{node: object|null}} null when no scope has an applicable indexer; `node` is null when the
     *   access is ambiguous (reported)
     */
    extensionIndexerAccess(scopes, target, args, syntax) {
      const within = this.c.containingType?.originalDefinition ?? null,
        receiver = { ...target, name: null, refKind: null },
        combined = [receiver, ...args];
      for (const scope of scopes) {
        const indexers = scope
            .map(entry => entry.symbol)
            .filter(symbol => symbol.kind === SymbolKind.Property && symbol.isExtensionIndexer && symbol.getMethod)
            .filter(symbol => isAccessible(symbol, within, { withinModule: this.d.assembly.module })),
          applicable = indexers.filter(indexer => this.isApplicableExtensionIndexer(indexer, combined));
        if (!applicable.length) continue;
        const getters = applicable.map(indexer => indexer.getMethod),
          result = this.d.overloads.resolve(getters, combined, { name: 'this' });
        if (!result.succeeded) {
          this.report(syntax, DiagnosticId.CS9339, applicable.slice(0, 2).map(indexer => indexer.getMethod.toDisplayString()));
          return { node: null };
        }
        return { node: this.extensionIndexerNode(applicable, getters, result, target, args, syntax) };
      }
      return null;
    }
    isApplicableExtensionIndexer(indexer, combined) {
      const result = this.d.overloads.resolve([indexer.getMethod], combined, { name: 'this' });
      return result.succeeded && isValidReceiverConversion(this.conversions, combined[0], result.method.parameters[0].type);
    }
    extensionIndexerNode(applicable, getters, result, target, args, syntax) {
      const getter = result.method,
        definition = applicable[getters.indexOf(getter.originalDefinition ?? getter)] ?? applicable[0],
        setter = definition.setMethod && getter !== definition.getMethod ? definition.setMethod.construct(getter.typeArguments) : definition.setMethod,
        property = getter === definition.getMethod ? definition : constructedIndexer(definition, getter, setter),
        receiver = this.convert(target, getter.parameters[0].type, target.syntax),
        converted = (argument, position) =>
          result.conversions[position] && (argument.type || argument.kind === 'MethodGroup')
            ? this.applyConversion(argument, result.parameterTypes[position], result.conversions[position])
            : argument;
      return this.node('IndexerAccess', syntax, property.type, {
        receiver,
        property,
        args: args.map((argument, index) => ({
          expression: converted(argument, index + 1),
          parameter: property.parameters[result.mapping.parameterOf[index + 1] - 1],
        })),
        // The mapping of the indexer's own parameter list: the receiver is not one of them.
        mapping: { ...result.mapping, parameterOf: result.mapping.parameterOf.slice(1).map(position => position - 1) },
        expanded: result.expanded,
      });
    }
  };
