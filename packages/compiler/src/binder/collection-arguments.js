/**
 * Collection expression arguments: `[with(arguments), elements]` (SF-A02-T88). PROVISIONAL: C# 15 preview, after
 * csharplang/proposals/csharp-15.0/collection-expression-arguments.md revision 1
 * (packages/syntax/src/preview-revisions.js). The pinned Roslyn does not implement the feature, so there is no Roslyn
 * fixture and no Roslyn diagnostic id for the rules that are new: those are SF2203 with the proposal reference.
 *
 * "Conversions": the presence of a `with` element, not its arguments, decides whether the conversion exists - with
 * one, a class or struct target needs an accessible constructor instead of a parameterless one
 * (./collection-expressions.js).
 *
 * "Construction":
 *   - the `with` element must be the first element; an argument of type `dynamic` is an error;
 *   - "Constructors": for a class or struct that implements IEnumerable and has no create method, overload
 *     resolution over its accessible constructors with the argument list picks the constructor; the arguments are
 *     evaluated before the elements (the bound node is the object creation with those arguments, followed by the
 *     element initializers);
 *   - "Interface target type": `IEnumerable<E>`, `IReadOnlyCollection<E>` and `IReadOnlyList<E>` take `()` only;
 *     `ICollection<E>` and `IList<E>` take the signatures of `List<E>()` and `List<E>(int)`;
 *   - "Other target types": a binding error for the argument list, even if empty (arrays, spans, ...).
 *
 * Not bound (SF2202): the create methods of a `[CollectionBuilder]` type ("CollectionBuilderAttribute methods") - the
 * binder does not bind create methods at all yet - and a type parameter target. The dictionary interfaces belong to
 * the dictionary expressions proposal, which is not implemented. For `ICollection<E>` / `IList<E>` the constructor is
 * chosen among all constructors of `List<E>` and then required to be one of the two signatures; the proposal resolves
 * among the two only, which differs for an argument that is ambiguous between `int` and another parameter type.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { TypeKind } from '../symbols/types.js';

const feature = 'CollectionExpressionArguments';

/** Class mixin of the body binder: the `with(...)` element of a collection expression. */
export const CollectionArgumentBinding = Base =>
  class extends Base {
    collectionArgumentRule(node, text) {
      this.report(node, DiagnosticId.SF2203, [text, previewStampText(feature)]);
    }
    /** Binds a `with(...)` element; returns `{syntax, args}`, or null when it is not the first element. */
    collectionArguments(element, index) {
      const args = this.arguments(element.argumentList);
      if (index !== 0) {
        this.collectionArgumentRule(element, 'collection arguments must be the first element of the collection expression');
        return null;
      }
      for (const argument of args)
        if (argument.type?.typeKind === TypeKind.Dynamic) this.collectionArgumentRule(argument.syntax, "collection arguments cannot have type 'dynamic'");
      return { syntax: element, args };
    }
    /**
     * The rules of the argument list for the kind of target (see ./collection-expressions.js `collectionTarget`).
     * @returns {boolean} true when the arguments are passed to the constructor that builds the collection
     */
    checkCollectionArguments(node, to, target) {
      const { syntax, args } = node.withArguments,
        display = this.display(to);
      if (target.kind === 'collection' && to.typeKind !== TypeKind.TypeParameter) return true;
      if (target.kind === 'builder' || to.typeKind === TypeKind.TypeParameter) {
        const what = target.kind === 'builder' ? 'a create method ([CollectionBuilder])' : 'a type parameter target';
        this.report(syntax, DiagnosticId.SF2202, [`collection arguments for ${what}`, previewStampText(feature)]);
        return false;
      }
      if (target.kind !== 'interface') {
        this.collectionArgumentRule(syntax, `collection arguments are not supported for the target type '${display}'`);
        return false;
      }
      const definition = to.originalDefinition ?? to,
        isMutable = definition === this.core.icollectionT || definition === this.core.ilistT;
      if (!isMutable && args.length) this.collectionArgumentRule(syntax, `the only candidate signature for '${display}' is '()'`);
      return isMutable;
    }
    collectionCreation(type, node, target) {
      const creation = super.collectionCreation(type, node, target);
      if (!node.withArguments || target.kind !== 'interface' || !creation || creation.hasErrors) return creation;
      // `ICollection<E>` and `IList<E>`: the signatures of `List<E>()` and `List<E>(int)` only.
      const parameters = creation.constructor?.parameters ?? [],
        isCandidate = parameters.length === 0 || (parameters.length === 1 && parameters[0].type?.specialType === 'System_Int32');
      if (!isCandidate && node.withArguments.args.length)
        this.collectionArgumentRule(node.withArguments.syntax, "the candidate signatures for this interface are 'List<E>()' and 'List<E>(int)'");
      return creation;
    }
  };
