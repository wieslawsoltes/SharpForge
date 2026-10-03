/**
 * C# 10 rules that are not a construct family of their own (SF-A02-T75).
 *
 *   Constant interpolated strings - `$"{A}b"` is a constant when every hole is a constant of type string without an
 *       alignment or a format (`interpolatedString`). The use of such a constant below C# 10 is gated where a
 *       constant is required.
 *   Extended property patterns - `{ A.B: p }` is bound as `{ A: { B: p } }` (`propertySubpattern`).
 *   CallerArgumentExpression - an omitted optional parameter marked `[CallerArgumentExpression("p")]` receives the
 *       source text of the argument given for `p` (`callerArgumentTexts`), and the attribute's own rules: CS8964
 *       (no default value), CS8959 (no conversion from string), CS8963 (unknown parameter, a warning) and CS8965
 *       (the parameter itself, a warning).
 */
import { SymbolKind, ErrorTypeSymbol } from '../symbols/types.js';
import { ConstantValue } from '../constants/constant-value.js';
import { attributesNamed } from './attributes.js';
import { lookupMembers } from './inheritance.js';
import { isSourceSymbol } from '../semantic/analysis-helpers.js';

export const callerArgumentExpressionAttribute = 'System.Runtime.CompilerServices.CallerArgumentExpressionAttribute';

const unknown = ErrorTypeSymbol.unknown;

/** The identifiers of `A` or `A.B.C` in a property pattern, outermost first; null for any other expression. */
function memberPath(expression) {
  const path = [];
  let node = expression;
  for (; node?.kind === 'SimpleMemberAccessExpression'; node = node.expression) {
    if (node.name?.kind !== 'IdentifierName') return null;
    path.unshift(node.name);
  }
  if (node?.kind !== 'IdentifierName') return null;
  path.unshift(node);
  return path;
}

/**
 * The text a literal part of an interpolated string contributes: `{{` and `}}` stand for one brace, except in a raw
 * string, whose braces are literal.
 * @param stringSyntax the InterpolatedStringExpression  @param content one of its InterpolatedStringText parts
 */
export function interpolationText(stringSyntax, content) {
  const text = content.textToken.value ?? content.textToken.valueText,
    isRaw = stringSyntax.stringStartToken.text.endsWith('"""');
  return isRaw ? text : text.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

const isStringConstant = part => !!part.constantValue && part.type?.specialType === 'System_String';

/**
 * The source texts for the omitted `[CallerArgumentExpression]` parameters of a resolved call.
 * @param method the called method  @param {number[]} parameterOf argument index -> parameter index
 * @param {object[]} args the bound arguments (`syntax` is the argument expression)
 * @param {(syntax:object)=>string} textOf the expression exactly as written, without the trivia around it
 * @returns {Map<number,string>|null} parameter index -> text, or null when the call has none
 */
export function callerArgumentTexts(method, parameterOf, args, textOf) {
  let texts = null;
  method.parameters.forEach((parameter, index) => {
    const target = parameter.callerArgumentExpression;
    if (target === undefined || target === null || parameterOf.includes(index)) return;
    const argument = parameterOf.indexOf(target);
    if (argument < 0) return;
    (texts ??= new Map()).set(index, textOf(args[argument].syntax));
  });
  return texts;
}

/** Class mixin of the body binder: C# 10 expression rules. */
export const CSharp10Binding = Base =>
  class extends Base {
    /** `$"..."`: binds the holes; the string is a constant when its holes are string constants without formatting. */
    interpolatedString(syntax) {
      const parts = [];
      let text = '',
        isConstant = true;
      for (const content of syntax.contents) {
        if (content.kind !== 'Interpolation') {
          text += interpolationText(syntax, content);
          continue;
        }
        const part = this.value(content.expression);
        parts.push(part);
        if (content.alignmentClause) this.convert(this.value(content.alignmentClause.value), this.core.int);
        if (content.alignmentClause || content.formatClause || !isStringConstant(part)) isConstant = false;
        else text += part.constantValue.value ?? '';
      }
      const node = this.node('InterpolatedString', syntax, this.core.string, { parts, form: 'interpolatedString' });
      if (isConstant && !parts.some(part => part.hasErrors)) {
        node.constantValue = ConstantValue.string(text);
        node.isConstantInterpolation = parts.length > 0;
      }
      return node;
    }
    /**
     * One `Name: pattern` of a property pattern. C# 10 allows a member path, `A.B: pattern`, which means
     * `A: { B: pattern }`: it is bound to exactly that nesting, so later passes see ordinary property patterns.
     * @returns {{member:object|null,pattern:object,syntax:object}}
     */
    propertySubpattern(sub, type) {
      const written = sub.expressionColon?.expression ?? sub.expressionColon?.name ?? sub.nameColon?.name,
        path = memberPath(written);
      if (written && !path) this.report(written, 'CS8918');
      const members = [];
      let current = type;
      for (const nameNode of path ?? []) {
        const member = current && !current.isErrorType() ? this.patternMember(current, nameNode) : null;
        if (!member) break;
        members.push(member);
        current = member.type;
      }
      const isComplete = !!path && members.length === path.length;
      let pattern = this.pattern(sub.pattern, isComplete ? current : unknown, null);
      for (let i = members.length - 1; i > 0 && isComplete; i--) {
        const inputType = members[i - 1].type;
        pattern = { kind: 'RecursivePattern', syntax: sub, inputType, properties: [{ member: members[i], pattern, syntax: sub }], positional: null };
      }
      return { member: isComplete ? members[0] : null, pattern, syntax: sub };
    }
    /** The field or property `nameNode` names in a value of `type`, or null after reporting why there is none. */
    patternMember(type, nameNode) {
      const name = nameNode.identifier.valueText,
        found = lookupMembers(type, name, this.core, { within: this.c.containingType }).members,
        member = found.find(m => m.kind === SymbolKind.Field || m.kind === SymbolKind.Property);
      if (member) {
        const definition = member.originalDefinition ?? member;
        if (member.kind === SymbolKind.Field) definition.reads = (definition.reads ?? 0) + 1;
        return member;
      }
      if (found.length) this.report(nameNode, 'CS0154', [name]);
      else if (isSourceSymbol(type) || type.specialType) this.report(nameNode, 'CS0117', [this.display(type), name]);
      else this.incomplete = this.d.incomplete = true;
      return null;
    }
    /** `{callerArguments}` for a resolved call whose omitted parameters take the text of other arguments, else `{}`. */
    callerArgumentsOf(method, mapping, args) {
      if (!method.parameters.some(parameter => parameter.callerArgumentExpression !== undefined)) return {};
      const source = this.d.sources.get(this.c.uri)?.text ?? '',
        textOf = syntax => source.slice(syntax.span.start, syntax.span.end);
      const callerArguments = callerArgumentTexts(method, mapping?.parameterOf ?? [], args, textOf);
      return callerArguments ? { callerArguments } : {};
    }
  };

/** Class mixin (analysis phase): the attribute-driven rules of C# 10, run once the attributes are bound. */
export const CSharp10Rules = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      for (const type of this.assembly.types)
        for (const member of type.getMembers()) {
          const parameters = member.kind === SymbolKind.Method || member.isIndexer ? (member.parameters ?? []) : [];
          parameters.forEach((parameter, index) => this.decodeCallerArgumentExpression(member, parameter, index));
        }
    }
    decodeCallerArgumentExpression(member, parameter, index) {
      const attribute = attributesNamed(parameter, callerArgumentExpressionAttribute)[0];
      if (!attribute) return;
      const uri = member.uri ?? this.at(member)?.uri,
        at = attribute.syntax.name,
        name = attribute.arguments[0]?.constantValue?.value ?? null;
      if (!parameter.isOptional && !parameter.defaultSyntax) {
        this.report(uri, at, 'CS8964');
        return;
      }
      const fromString = this.conversions.classifyImplicit(this.core.string, parameter.type);
      if (parameter.type && !parameter.type.isErrorType() && !fromString.exists) {
        this.report(uri, at, 'CS8959', [this.core.string.toDisplayString(), parameter.type.toDisplayString()]);
        return;
      }
      const target = member.parameters.findIndex(candidate => candidate.name === name);
      if (target < 0) this.report(uri, at, 'CS8963', [parameter.name]);
      else if (target === index) this.report(uri, at, 'CS8965', [parameter.name]);
      else parameter.callerArgumentExpression = target;
    }
  };
