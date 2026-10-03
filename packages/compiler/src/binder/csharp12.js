/**
 * C# 12 rules that are not a construct family of their own (SF-A02-T80).
 *
 *   Inline arrays - `[InlineArray(n)]` on a struct: CS9167 (the length is not positive), CS9169 (the struct does not
 *       declare exactly one instance field). Element access and foreach are bound in ./inline-arrays.js.
 *   Experimental - a use of a type or member marked `[Experimental("ID")]` is an error with that ID, unless the use
 *       is inside a declaration marked with the same ID.
 *
 *   Interceptors - `[InterceptsLocation]` is always rejected: diagnostics only (./interceptors.js).
 *
 * Collection expressions are in ./collection-expressions.js. Type aliases of any type, `ref readonly` parameters and
 * primary constructors are bound by the type binder, the by-reference rules and binder/members.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { formatMessage } from '../diagnostics/codes.js';
import { attributesNamed } from './bound-attributes.js';
import { checkInterceptor } from './interceptors.js';

const inlineArrayAttribute = 'System.Runtime.CompilerServices.InlineArrayAttribute';
const experimentalAttribute = 'System.Diagnostics.CodeAnalysis.ExperimentalAttribute';

const constantOf = argument => argument?.constantValue?.value;
const spanOf = node => node.span ?? node;

/**
 * Rules of an `[InlineArray]` struct.
 * @returns {{at:object|null,code:string,args:any[]}[]} `at` null means the type's own location
 */
export function checkInlineArray(type) {
  const attribute = attributesNamed(type, inlineArrayAttribute)[0];
  if (!attribute || type.typeKind !== TypeKind.Struct) return [];
  const rows = [],
    length = constantOf(attribute.arguments[0]),
    fields = type.getMembers().filter(member => member.kind === SymbolKind.Field && !member.isStatic && !member.isImplicitlyDeclared);
  const badLength = length !== undefined && Number(length) <= 0;
  if (badLength) rows.push({ at: attribute.arguments[0].syntax, code: DiagnosticId.CS9167, args: [] });
  if (fields.length !== 1) rows.push({ at: null, code: DiagnosticId.CS9169, args: [] });
  // The fields of an inline array are its storage: they are not "never used" or "never assigned" (as in Roslyn).
  if (!badLength)
    for (const field of fields) {
      field.reads = (field.reads ?? 0) + 1;
      field.writes = (field.writes ?? 0) + 1;
      field.nonConstantWrite = true;
    }
  return rows;
}

/** The syntax extents of a source declaration: every part of a type, the declaration of a member. */
function declarationSpans(symbol) {
  if (symbol.kind === SymbolKind.NamedType) return (symbol.declarations ?? []).map(d => ({ uri: d.uri, ...spanOf(d.syntax) }));
  const syntax = symbol.declarationSyntax ?? symbol.syntax,
    uri = symbol.uri ?? symbol.locations?.[0]?.uri;
  return syntax && uri ? [{ uri, ...spanOf(syntax) }] : [];
}

/** Class mixin (analysis phase): the attribute-driven rules of C# 12, run once the attributes are bound. */
export const CSharp12Rules = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      for (const type of this.assembly.types) {
        for (const row of checkInlineArray(type)) this.report(this.at(type).uri, row.at ?? this.at(type), row.code, row.args);
        for (const symbol of [type, ...type.getMembers()]) {
          const id = constantOf(attributesNamed(symbol, experimentalAttribute)[0]?.arguments[0]);
          if (typeof id === 'string' && id) symbol.experimentalId = id;
          if (symbol.kind !== SymbolKind.Method) continue;
          const uri = symbol.uri ?? this.at(symbol).uri;
          for (const row of checkInterceptor(symbol)) this.report(uri, row.at, row.code, row.args);
        }
      }
    }
  };

/** Class mixin (analysis phase, after the uses of symbols are recorded): reports uses of experimental symbols. */
export const ExperimentalUses = Base =>
  class extends Base {
    reportObsoleteUses() {
      super.reportObsoleteUses();
      const uses = (this.symbolUses ?? []).filter(use => use.symbol.experimentalId);
      if (!uses.length) return;
      const contexts = [];
      for (const type of this.assembly.types)
        for (const symbol of [type, ...type.getMembers()])
          if (symbol.experimentalId) for (const span of declarationSpans(symbol)) contexts.push({ ...span, id: symbol.experimentalId });
      for (const { symbol, uri, node } of uses) {
        const { start, end } = spanOf(node),
          id = symbol.experimentalId;
        if (contexts.some(c => c.id === id && c.uri === uri && c.start <= start && end <= c.end)) continue;
        // The diagnostic carries the ID the attribute names; its text is that of Roslyn's CS9204.
        this.push(uri, node, id, formatMessage(DiagnosticId.CS9204, [symbol.toDisplayString()]), 'error');
      }
    }
  };
