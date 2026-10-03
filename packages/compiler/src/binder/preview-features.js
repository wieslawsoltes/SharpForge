/**
 * C# 15 preview semantics (SF-A02-E12). PROVISIONAL: every rule here follows a pinned csharplang proposal revision
 * (packages/syntax/src/preview-revisions.js). The pinned Roslyn implements none of these features, so there are no
 * Roslyn fixtures and no Roslyn diagnostic codes for them; nothing beyond the proposal text is implemented.
 * The parser gates the syntax (CS8652 unless LangVersion is preview); this module runs for preview files only.
 *
 * Bound (closed hierarchies and closed enums, SF-A02-T90):
 *   - a `closed` class is implicitly abstract; `sealed`, `static` or an explicit `abstract` on it is an error;
 *   - a generic class that directly derives from a closed class must use all its type parameters in the base class;
 *   - a closed enum must declare a member for the value 0;
 *   - the classes that directly derive from a closed class are recorded with it (`closedSubtypes`), and the members
 *     of a closed enum are all its values (`isClosedEnum`): flow/pattern-exhaustiveness.js decides exhaustiveness
 *     from them, ./closed-types.js checks the uses in bodies.
 *
 * Not bound, reported instead of guessed (SF2202 names the feature and its proposal):
 *   unions (SF-A02-T89), the `safe` modifier and `unsafe(...)` expressions (SF-A02-T92), extension indexers
 *   (SF-A02-T91).
 *
 * The proposals name no diagnostic ids, so the rules use two SharpForge codes: SF2202 "preview feature is not
 * bound" and SF2203 "preview rule", each with the proposal reference in its message.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { TypeKind } from '../symbols/types.js';
import { containsTypeParameter } from '../symbols/substitution.js';

const modifiersOf = syntax => (syntax.modifiers ?? []).map(token => token.text);
const isZero = value => value === 0 || value === 0n || Number(value?.value ?? NaN) === 0;

/** The preview constructs the binder does not bind: `[catalog feature id, display name, node to report at]` rows of one file. */
export function unboundPreviewConstructs(root) {
  const rows = [],
    stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.kind === 'UnionDeclaration') rows.push(['Unions', 'unions', node.identifier ?? node]);
    else if (node.kind === 'UnsafeExpression') rows.push(['UnsafeExpressions', 'unsafe expressions', node]);
    else if (node.kind === 'IndexerDeclaration' && node.parent?.kind === 'ExtensionBlockDeclaration')
      rows.push(['ExtensionIndexers', 'extension indexers', node.thisKeyword]);
    const safe = (node.modifiers ?? []).find?.(token => token.kind === 'SafeKeyword');
    if (safe) rows.push(['SafeModifier', 'the safe modifier', safe]);
    for (const child of node.childNodes()) stack.push(child);
  }
  return rows.sort((a, b) => a[2].span.start - b[2].span.start);
}

/** Class mixin (analysis phase): the provisional rules of the C# 15 preview features. */
export const PreviewFeatureRules = Base =>
  class extends Base {
    isPreview(uri) {
      return this.versionOf(uri).preview === true;
    }
    bindAttributes() {
      super.bindAttributes();
      for (const file of this.files) {
        if (!file.syntax || !this.isPreview(file.source.uri)) continue;
        for (const [id, name, node] of unboundPreviewConstructs(file.syntax)) this.report(file.source.uri, node, DiagnosticId.SF2202, [name, previewStampText(id)]);
      }
    }
    closedDeclarationOf(type) {
      return (type.declarations ?? []).find(part => modifiersOf(part.syntax).includes('closed') && this.isPreview(part.uri)) ?? null;
    }
    /** Records a class that directly derives from a closed class with it, and checks the type parameter restriction. */
    checkClosedBase(type) {
      const base = type.typeKind === TypeKind.Class ? type.baseType : null,
        definition = base?.originalDefinition;
      if (!definition || definition.typeKind !== TypeKind.Class || !this.closedDeclarationOf(definition)) return;
      (definition.closedSubtypes ??= []).push(type);
      const part = type.declarations[0];
      for (const parameter of type.typeParameters ?? []) {
        if (containsTypeParameter(base, [parameter])) continue;
        const text = `the type parameter '${parameter.name}' of a class that derives from a closed class must be used in the base class`;
        this.report(part.uri, part.syntax.identifier, DiagnosticId.SF2203, [text, previewStampText('ClosedClasses')]);
      }
    }
    checkType(type) {
      const closed = this.closedDeclarationOf(type);
      if (closed && type.typeKind === TypeKind.Class) {
        type.isAbstract = true;
        type.isClosedClass = true;
      }
      super.checkType(type);
      this.checkClosedBase(type);
      if (!closed) return;
      const at = closed.syntax.identifier,
        rule = (id, text) => this.report(closed.uri, at, DiagnosticId.SF2203, [text, previewStampText(id)]);
      if (type.typeKind === TypeKind.Enum) {
        type.isClosedEnum = true;
        if (!type.getMembers().some(member => member.isEnumMember && isZero(member.constantValue)))
          rule('ClosedEnums', 'a closed enum must declare a member corresponding to the integral value 0');
        return;
      }
      const modifiers = modifiersOf(closed.syntax);
      for (const word of ['sealed', 'static']) if (modifiers.includes(word)) rule('ClosedClasses', `a closed class cannot also have the '${word}' modifier`);
      if (modifiers.includes('abstract')) rule('ClosedClasses', "a closed class is implicitly abstract: the 'abstract' modifier is an error");
    }
  };
