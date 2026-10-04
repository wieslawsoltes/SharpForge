/**
 * The updated memory safety rules: requires-unsafe members and their callers (SF-A02-T92). PROVISIONAL: C# 15
 * preview, after csharplang/proposals/unsafe-evolution.md revision 1 (packages/syntax/src/preview-revisions.js). The
 * pinned Roslyn does not implement them, so every rule is the text of the proposal and is reported with SF2203, which
 * names it. The rules apply only when the compilation opts in (`memorySafetyRules: true`; the proposal speaks of "the
 * assembly-wide opt-in switch" without naming it) and the file is compiled as preview.
 *
 * "Unsafe modifiers and contexts"
 *   "With opt-in to the updated memory safety rules, `unsafe` on a member marks it as requires-unsafe ... and does not
 *    introduce an `unsafe` context (instead, only explicit `unsafe` regions in the body establish `unsafe` contexts)."
 *   "`unsafe` on the following declarations produces an error because it does not have a meaning anymore: delegate,
 *    static constructor, destructor, type declaration."
 *   "`unsafe` on a constructor introduces an `unsafe` context inside its initializer."
 *   "To mark a local function as requires-unsafe, it must manually be marked as `unsafe`."
 *   "If the accessors don't have the `unsafe`/`safe` modifier, they inherit it from the property."
 * "Redefining expressions that require unsafe contexts"
 *   "calling a method that is requires-unsafe will cause the invocation_expression to require an `unsafe` context" -
 *   and so does any other use of a requires-unsafe member: creating an object with such a constructor, reading or
 *   writing such a field, property or event.
 * "Delegates and lambdas"
 *   "It is a memory safety error to convert a requires-unsafe member to a delegate type outside the `unsafe` context."
 * "Overriding, inheritance, and implementation"
 *   "It is a memory safety error to add `unsafe` at the member level in any override or implementation of a member
 *    that is not requires-unsafe originally."
 * "`extern`"
 *   "under the updated memory-safety rules, the compiler requires each `extern` method to be explicitly marked as
 *    either `unsafe` or `safe`."
 * "Fields"
 *   "In a type with `[StructLayout(LayoutKind.Explicit)]` ..., all instance fields must be marked either `safe` or
 *    `unsafe`. If the field is hidden behind an auto-property ..., the requirement is moved to the auto-property."
 *
 * Not bound (the issue lists them): requires-unsafe members read from metadata (`RequiresUnsafeAttribute`,
 * `MemorySafetyRulesAttribute`) and the compat mode for assemblies with the legacy rules; the pointer relaxations
 * outside unsafe contexts; the `stackalloc` rule under `[SkipLocalsInit]`; the `new()` constraint rule; the
 * restrictions on placing `unsafe` / `safe` on a property and on its accessors at once; emission of the attributes.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { walk } from '../bound/semantic-walker.js';
import { attributesNamed } from './bound-attributes.js';

const feature = 'SafeModifier';
const layoutAttribute = 'System.Runtime.InteropServices.StructLayoutAttribute';
const explicitLayout = 2;
const wordsOf = syntax => (syntax?.modifiers ?? []).map(token => token.text);

/** The syntax that carries the modifiers of a member: the field declaration of a field, else the declaration itself. */
const declarationOf = member => (member.kind === SymbolKind.Field ? (member.declarationSyntax ?? member.syntax) : member.syntax);

/** `unsafe` or `safe` when a declaration is marked so, else null; an accessor without its own inherits the property's. */
export function safetyModifierOf(member) {
  const own = wordsOf(declarationOf(member)),
    owner = member.kind === SymbolKind.Method && member.isAccessor ? member.associatedSymbol : null,
    words = own.includes('unsafe') || own.includes('safe') || !owner ? own : wordsOf(declarationOf(owner));
  return words.includes('unsafe') ? 'unsafe' : words.includes('safe') ? 'safe' : null;
}

/** True for a source member that is requires-unsafe under the updated rules: it is declared `unsafe`. */
export function isRequiresUnsafe(member) {
  const definition = member?.originalDefinition ?? member;
  return !!definition?.syntax && definition.kind !== SymbolKind.NamedType && safetyModifierOf(definition) === 'unsafe';
}

/** The member a bound node uses, when using it can require an unsafe context. */
function usedMember(node) {
  switch (node.kind) {
    case 'Call':
    case 'DelegateCreation':
      return node.method ?? null;
    case 'ObjectCreation':
      return node.constructor && typeof node.constructor === 'object' ? node.constructor : null;
    case 'FieldAccess':
      return node.field;
    case 'PropertyAccess':
    case 'IndexerAccess':
      return node.property ?? null;
    case 'EventAccess':
    case 'EventAssignment':
      return node.event;
    case 'Conversion':
      // A method group converted to a delegate type.
      return node.conversion?.kind === 'MethodGroup' ? (node.method ?? node.operand?.method ?? node.conversion.method ?? null) : null;
    default:
      return null;
  }
}

/**
 * True when a syntax node is in an explicit unsafe region: an `unsafe` block, an `unsafe(...)` expression, or the
 * initializer of an `unsafe` constructor. `unsafe` on the enclosing member is not one.
 */
export function isInUnsafeRegion(syntax) {
  for (let node = syntax; node; node = node.parent) {
    if (node.kind === 'UnsafeStatement' || node.kind === 'UnsafeExpression') return true;
    if (/ConstructorInitializer$/.test(node.kind)) return wordsOf(node.parent).includes('unsafe');
  }
  return false;
}

/** True when the file is compiled as preview and the compilation opted in to the updated rules. */
const usesUpdatedRules = (analysis, uri) => analysis.options.memorySafetyRules === true && analysis.versionOf(uri).preview === true;
const reportRule = (analysis, uri, node, text) => analysis.report(uri, node, DiagnosticId.SF2203, [text, previewStampText(feature)]);

/** Class mixin (analysis phase, once the attributes are bound): the declaration rules, when the compilation opts in. */
export const MemorySafetyRules = Base =>
  class extends Base {
    memorySafetyRule(uri, node, text) {
      reportRule(this, uri, node, text);
    }
    bindAttributes() {
      super.bindAttributes();
      for (const type of this.assembly.types) this.checkTypeSafety(type);
    }
    checkTypeSafety(type) {
      const uri = this.at(type).uri;
      if (!type.isSource || !usesUpdatedRules(this, uri)) return;
      for (const part of type.declarations ?? []) {
        if (!wordsOf(part.syntax).includes('unsafe')) continue;
        const what = type.typeKind === TypeKind.Delegate ? 'a delegate' : 'a type declaration';
        this.memorySafetyRule(part.uri, part.syntax.identifier, `'unsafe' on ${what} has no meaning under the updated memory safety rules`);
      }
      for (const member of type.getMembers()) this.checkMemberSafety(member, type);
    }
    checkMemberSafety(member, type) {
      if (member.isImplicitlyDeclared || !member.syntax || member.kind === SymbolKind.NamedType) return;
      const uri = member.uri ?? this.at(member).uri,
        at = this.at(member),
        modifier = safetyModifierOf(member),
        words = wordsOf(declarationOf(member)),
        rule = text => this.memorySafetyRule(uri, at, text);
      if (member.kind === SymbolKind.Method && modifier === 'unsafe') {
        if (member.methodKind === MethodKind.StaticConstructor) rule("'unsafe' on a static constructor has no meaning under the updated memory safety rules");
        if (member.methodKind === MethodKind.Destructor) rule("'unsafe' on a destructor has no meaning under the updated memory safety rules");
      }
      if (member.kind === SymbolKind.Method && words.includes('extern') && !modifier)
        rule(`the extern method '${member.toDisplayString()}' must be marked 'safe' or 'unsafe'`);
      if (modifier === 'unsafe' && !(member.kind === SymbolKind.Method && member.isAccessor)) this.checkAddedUnsafe(member, type, rule);
      this.checkExplicitLayoutMember(member, type, modifier, rule);
    }
    /** An override or implementation must not add `unsafe` to a member that is not requires-unsafe. */
    checkAddedUnsafe(member, type, rule) {
      const bases = [];
      if (member.overriddenMember) bases.push(member.overriddenMember);
      for (const [declaration, implementation] of type.interfaceImplementations ?? []) if (implementation === member) bases.push(declaration);
      for (const base of bases) {
        if (isRequiresUnsafe(base)) continue;
        rule(`'${member.toDisplayString()}' cannot add 'unsafe': '${base.toDisplayString()}' is not requires-unsafe`);
      }
    }
    /** In an explicit-layout type every instance field (or the auto-property that hides it) says `safe` or `unsafe`. */
    checkExplicitLayoutMember(member, type, modifier, rule) {
      if (modifier || member.isStatic || member.isConst) return;
      const isField = member.kind === SymbolKind.Field && !member.isImplicitlyDeclared && !member.isEnumMember,
        isAutoProperty = member.kind === SymbolKind.Property && member.isAutoProperty;
      if (!isField && !isAutoProperty) return;
      const layout = attributesNamed(type, layoutAttribute)[0],
        kind = layout?.arguments?.[0]?.constantValue?.value;
      if (Number(kind) !== explicitLayout) return;
      rule(`'${member.toDisplayString()}' is in a type with explicit layout and must be marked 'safe' or 'unsafe'`);
    }
  };

/** Class mixin (analysis phase, once the bodies are bound): uses of requires-unsafe members. */
export const MemorySafetyUses = Base =>
  class extends Base {
    bindBodies() {
      super.bindBodies();
      for (const [member, body] of this.bound) {
        const uri = body.binder?.c.uri ?? member.uri ?? this.at(member)?.uri;
        if (!uri || !usesUpdatedRules(this, uri)) continue;
        walk(body, node => {
          const used = usedMember(node);
          if (!used || !isRequiresUnsafe(used) || isInUnsafeRegion(node.syntax)) return;
          const isConversion = node.kind === 'Conversion' || node.kind === 'DelegateCreation',
            text = isConversion
              ? `'${used.toDisplayString()}' is requires-unsafe: it can be converted to a delegate type only in an unsafe context`
              : `'${used.toDisplayString()}' is requires-unsafe: it can be used only in an unsafe context`;
          reportRule(this, uri, node.syntax, text);
        });
      }
    }
  };
