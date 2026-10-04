/**
 * Caller info attributes (SF-A02-T57): `[CallerMemberName]`, `[CallerFilePath]`, `[CallerLineNumber]` and C# 10
 * `[CallerArgumentExpression]` on an optional parameter make the compiler pass, for an omitted argument, a constant
 * that describes the call site instead of the declared default.
 *
 * The attributes are decoded from the bound attributes of the parameter, by the full name of the attribute class
 * (binder/attributes.js). `callerInfoOf` says which one applies (line number wins over file path, which wins over
 * member name, which wins over argument expression); `checkCallerInfoParameters` is the declaration rule;
 * `callerInfoArguments` computes the constants of one call, which the binder records on the bound node as
 * `callerInfo` (parameter ordinal -> value) and code generation uses in place of the default value.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { createLineMap } from '@sharpforge/syntax';
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const namespaceName = 'System.Runtime.CompilerServices.';
/** In precedence order: when several are applied, the first one is used and the others have no effect. */
const kinds = [
  { kind: 'line', className: 'CallerLineNumberAttribute', missingDefault: DiagnosticId.CS4020, badType: DiagnosticId.CS4017 },
  { kind: 'path', className: 'CallerFilePathAttribute', missingDefault: DiagnosticId.CS4021, badType: DiagnosticId.CS4018 },
  { kind: 'member', className: 'CallerMemberNameAttribute', missingDefault: DiagnosticId.CS4022, badType: DiagnosticId.CS4019 },
  { kind: 'expression', className: 'CallerArgumentExpressionAttribute', missingDefault: DiagnosticId.CS8964, badType: DiagnosticId.CS8959 },
];
/** The warning for an attribute that a stronger one overrides: [overridden kind][winning kind]. */
const overridden = {
  member: { line: DiagnosticId.CS7081, path: DiagnosticId.CS7080 },
  path: { line: DiagnosticId.CS7082 },
  expression: { line: DiagnosticId.CS8960, path: DiagnosticId.CS8961, member: DiagnosticId.CS8962 },
};

/** The namespace-qualified name of an attribute class (`System.Runtime.CompilerServices.CallerLineNumberAttribute`). */
function fullNameOf(type) {
  const parts = [];
  for (let symbol = type?.originalDefinition ?? type; symbol && symbol.name; symbol = symbol.containingSymbol) parts.unshift(symbol.name);
  return parts.join('.');
}
// Not imported from ./attributes.js: that module binds attribute arguments with the body binder, which composes this one.
const attributesNamed = (symbol, fullName) => symbol.boundAttributes.filter(attribute => fullNameOf(attribute.attributeClass) === fullName);

/** The caller info attributes applied to a parameter, strongest first: `[{ kind, attribute, ...codes }]`. */
function appliedTo(parameter) {
  const definition = parameter.originalDefinition ?? parameter;
  if (!definition.boundAttributes) return importedAttributes(definition);
  if (!definition.boundAttributes.length) return [];
  return kinds.flatMap(row => attributesNamed(definition, namespaceName + row.className).map(attribute => ({ ...row, attribute })));
}

/** The same for a parameter of a referenced assembly, whose attributes are decoded metadata (`ThrowIfNull(argument, paramName)`). */
function importedAttributes(definition) {
  const attributes = definition.metadataToken === undefined ? null : definition.attributes;
  if (!attributes?.length) return [];
  const asBound = attribute => ({ arguments: attribute.constructorArguments.map(argument => ({ constantValue: { value: argument.value } })) });
  return kinds.flatMap(row =>
    attributes
      .filter(attribute => attribute.attributeClassName === namespaceName + row.className)
      .map(attribute => ({ ...row, attribute: asBound(attribute) })),
  );
}

/** The parameter name a `[CallerArgumentExpression("name")]` attribute gives, or null. */
function targetNameOf(attribute) {
  const value = attribute.arguments?.[0]?.constantValue?.value;
  return typeof value === 'string' ? value : null;
}

/**
 * The caller info a parameter receives when its argument is omitted.
 * @returns {null|{kind:'line'|'path'|'member'|'expression', target:object|null}} `target` is the parameter whose
 *   argument text a `[CallerArgumentExpression]` passes
 */
export function callerInfoOf(parameter, method) {
  if (!parameter.isOptional) return null;
  const [strongest] = appliedTo(parameter);
  if (!strongest) return null;
  if (strongest.kind !== 'expression') return { kind: strongest.kind, target: null };
  const name = targetNameOf(strongest.attribute),
    definition = parameter.originalDefinition ?? parameter,
    target = method.parameters.find(candidate => candidate.name === name && (candidate.originalDefinition ?? candidate) !== definition);
  return target ? { kind: 'expression', target } : null;
}

/**
 * The declaration rule for the parameters of one method.
 * @param {(from:object,to:object)=>boolean} converts whether a standard implicit conversion exists
 * @param {{int:object,string:object}} types the types the attributes supply
 * @returns {object[]} rows `{ code, args, at }` with `at` the attribute's name
 */
export function checkCallerInfoParameters(method, converts, types) {
  const rows = [];
  for (const parameter of method.parameters) {
    const applied = appliedTo(parameter);
    if (!applied.length) continue;
    const [strongest, ...others] = applied,
      row = (entry, code, args = []) => rows.push({ code, args, at: entry.attribute.syntax.name });
    for (const entry of others) {
      const code = overridden[entry.kind]?.[strongest.kind];
      if (code) row(entry, code);
    }
    if (!parameter.isOptional) {
      row(strongest, strongest.missingDefault);
      continue;
    }
    const supplied = strongest.kind === 'line' ? types.int : types.string;
    if (!converts(supplied, parameter.type)) {
      row(strongest, strongest.badType, [supplied.toDisplayString(), parameter.type.toDisplayString()]);
      continue;
    }
    if (strongest.kind !== 'expression') continue;
    const name = targetNameOf(strongest.attribute);
    if (name === parameter.name) row(strongest, DiagnosticId.CS8965, [parameter.name]);
    else if (!method.parameters.some(candidate => candidate.name === name)) row(strongest, DiagnosticId.CS8963, [parameter.name]);
  }
  return rows;
}

/** The name `[CallerMemberName]` passes for code in `member` (a method, accessor, constructor or initialized field). */
export function callerMemberName(member) {
  if (!member) return '<Main>$';
  if (member.kind !== SymbolKind.Method) return member.isIndexer ? 'Item' : member.name;
  switch (member.methodKind) {
    case MethodKind.Constructor:
      return '.ctor';
    case MethodKind.StaticConstructor:
      return '.cctor';
    case MethodKind.Destructor:
      return 'Finalize';
    default:
      break;
  }
  const owner = member.associatedSymbol;
  if (member.isAccessor && owner) return owner.isIndexer ? 'Item' : owner.name;
  return member.simpleName ?? member.name;
}

/**
 * The constants one call passes for its omitted caller info parameters.
 * @param method the called method  @param {number[]} parameterOf for each argument, the ordinal of its parameter
 * @param {object[]} argumentSyntax for each argument, its expression syntax (or null)
 * @param {{member:object|null, line:number, path:string}} site where the call is
 * @returns {Map<number,string|number>} parameter ordinal -> value; empty when the call passes none
 */
export function callerInfoArguments(method, parameterOf, argumentSyntax, site) {
  const values = new Map();
  for (const parameter of method.parameters) {
    if (parameterOf.includes(parameter.ordinal)) continue;
    const info = callerInfoOf(parameter, method);
    if (!info) continue;
    if (info.kind === 'line') values.set(parameter.ordinal, site.line);
    else if (info.kind === 'path') values.set(parameter.ordinal, site.path);
    else if (info.kind === 'member') values.set(parameter.ordinal, callerMemberName(site.member));
    else {
      const index = parameterOf.indexOf(info.target.ordinal),
        syntax = index >= 0 ? argumentSyntax[index] : null;
      // Without an argument for the target the declared default of the parameter is used.
      if (syntax) values.set(parameter.ordinal, syntax.toString().trim());
    }
  }
  return values;
}

/** Line number (1-based) of the token a call is located at: the member name of an invocation, `new` of a creation. */
function callLine(syntax, source) {
  let anchor = syntax;
  if (syntax.kind === 'InvocationExpression') {
    const callee = syntax.expression;
    anchor = callee.kind === 'SimpleMemberAccessExpression' ? callee.name : callee;
  }
  return source.positionAt((anchor.span ?? anchor).start).line + 1;
}

/**
 * The line and file a call is at for caller info: `#line` directives remap both (`#line 100 "other.cs"`); a
 * `#line hidden` region keeps counting in the mapping before it, and `#line default` returns to the file itself.
 * @param lineMap the file's `createLineMap` result (its entries are the active `#line` directives)
 * @returns {{line:number, path:string}}
 */
export function callSite(syntax, lineMap, source, uri) {
  const line = callLine(syntax, source),
    offset = (syntax.span ?? syntax).start;
  let mapping = null;
  for (const entry of lineMap?.entries ?? []) {
    if (entry.at > offset) break;
    if (entry.mode !== 'hidden') mapping = entry;
  }
  if (!mapping || mapping.mode === 'default') return { line, path: uri };
  const first = mapping.mode === 'span' ? mapping.start.line : mapping.line;
  return { line: first + (line - 1 - mapping.from), path: mapping.file ?? uri };
}

/** Class mixin for the body binder: a call records the caller info it passes for omitted arguments. */
export const CallerInfoBinding = Base =>
  class extends Base {
    finishCall(result, receiver, args, syntax, options) {
      const node = super.finishCall(result, receiver, args, syntax, options);
      return node.kind === 'Call' ? this.withCallerInfo(node, result.method, result.mapping, args, syntax) : node;
    }
    /** An indexer may declare caller info parameters after its index parameters. */
    elementAccessOn(target, args, syntax) {
      const node = super.elementAccessOn(target, args, syntax);
      return node.kind === 'IndexerAccess' && node.property.parameters ? this.withCallerInfo(node, node.property, node.mapping, args, syntax) : node;
    }
    /** The `#line` map of a file, built once per analysis. */
    lineMapOf(uri, source) {
      const maps = (this.d.lineMaps ??= new Map());
      if (!maps.has(uri)) maps.set(uri, createLineMap(source, this.d.files.find(file => file.source.uri === uri)?.directives ?? []));
      return maps.get(uri);
    }
    /** Records on `node` the caller info `signature` (a method or an indexer) receives for the arguments left out. */
    withCallerInfo(node, signature, mapping, args, syntax) {
      if (!mapping?.parameterOf) return node;
      const root = this.rootBinder.c,
        uri = this.c.uri ?? '',
        source = this.d.sources.get(uri),
        site = source ? callSite(syntax, this.lineMapOf(uri, source), source, uri) : { line: 0, path: uri };
      const values = callerInfoArguments(
        signature,
        mapping.parameterOf,
        args.map(argument => argument.syntax ?? null),
        { member: root.method ?? root.initializerOf ?? null, ...site },
      );
      if (values.size) node.callerInfo = values;
      return node;
    }
  };

/** Class mixin of the semantic analysis: the declaration rule runs once attributes are bound. */
export const CallerInfoChecks = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      // The line is supplied as an `int` constant: besides the standard conversions from `int` it reaches `uint` and
      // `ulong` (a constant conversion; the smaller types cannot hold every line number).
      const unsigned = new Set(['System_UInt32', 'System_UInt64']),
        underlying = type => (type.originalDefinition?.specialType === 'System_Nullable_T' ? type.typeArguments[0].type : type);
      const isStandard = (from, to) => {
        const conversion = this.conversions.classifyImplicit(from, to);
        if (conversion.exists) return !conversion.isUserDefined;
        return from === this.core.int && unsigned.has(underlying(to).specialType);
      };
      const types = { int: this.core.int, string: this.core.string };
      for (const type of this.assembly.types) {
        for (const member of type.getMembers()) {
          // The parameters of an indexer carry attributes too; the attribute pass binds only those of methods.
          if (member.kind === SymbolKind.Property && member.isIndexer) {
            for (const parameter of member.parameters) this.bindDeclared(parameter, parameter.syntax, member.scope ?? type.primaryScope, type);
          }
          if (member.kind !== SymbolKind.Method || member.isImplicitlyDeclared) continue;
          for (const row of checkCallerInfoParameters(member, isStandard, types)) this.report(this.at(member).uri, row.at, row.code, row.args);
        }
      }
    }
  };
