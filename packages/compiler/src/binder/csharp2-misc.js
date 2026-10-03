/**
 * Conditional methods (SF-A02-T51): a call to a method marked `[Conditional("SYMBOL")]` is omitted, together with the
 * evaluation of its arguments, unless one of the method's symbols is defined in the file that contains the call.
 *
 *   - The symbols defined in a file are the `preprocessorSymbols` option plus the file's `#define` directives minus
 *     its `#undef` directives (both are only allowed before the first token, so they hold for the whole file).
 *   - The attribute is `System.Diagnostics.ConditionalAttribute` as bound by ./attributes.js: a `using` alias or a
 *     qualified name denotes it, a user class with the same simple name in another namespace does not. Imported
 *     methods carry the symbols decoded from metadata.
 *   - Declaration rules: the method returns void (CS0578), is not an interface member (CS0582), an override (CS0243),
 *     an explicit interface implementation, operator or destructor (CS0577), has no out parameter (CS0685), and the
 *     argument is an identifier (CS0633). On a class the attribute needs an attribute class (CS1689). A constructor
 *     is not among the targets the attribute declares, which the attribute binder reports (CS0592).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { attributesNamed } from './bound-attributes.js';

const conditionalAttribute = 'System.Diagnostics.ConditionalAttribute';
const identifier = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*$/u;

/**
 * The bound `[Conditional(...)]` attributes of a source symbol as `[{ attribute, argument, symbol }]`: the attribute
 * syntax, its argument syntax and the symbol text (null when the argument is not a string constant).
 */
export function conditionalAttributes(symbol) {
  return attributesNamed(symbol, conditionalAttribute).map(bound => {
    const value = bound.arguments[0]?.constantValue?.value;
    return {
      attribute: bound.syntax,
      argument: bound.syntax.argumentList?.arguments?.[0]?.expression ?? null,
      symbol: typeof value === 'string' ? value : null,
    };
  });
}

/** The conditional symbols of a method: of its bound attributes when declared in source, else those read from metadata. */
export function conditionalSymbolsOf(method) {
  const definition = method?.originalDefinition ?? method;
  if (!definition || definition.kind !== SymbolKind.Method) return [];
  if (!definition.boundAttributes) return definition.conditionalSymbols ?? [];
  definition.conditionalSymbols ??= conditionalAttributes(definition)
    .map(entry => entry.symbol)
    .filter(symbol => symbol !== null);
  return definition.conditionalSymbols;
}

/** The preprocessor symbols defined in one parsed file. */
export function definedSymbols(file, options = {}) {
  const given = options.preprocessorSymbols ?? [],
    symbols = new Set(Array.isArray(given) ? given : String(given).split(/[;,]/).map(symbol => symbol.trim()));
  symbols.delete('');
  for (const directive of file.directives ?? []) {
    const structure = directive.structure;
    if (!structure?.isActive || !structure.name) continue;
    if (directive.kind === 'DefineDirectiveTrivia') symbols.add(structure.name);
    else if (directive.kind === 'UndefDirectiveTrivia') symbols.delete(structure.name);
  }
  return symbols;
}

/** True when a call to `method` written in a file with the symbols `defined` is omitted. */
export function isCallOmitted(method, defined) {
  const symbols = conditionalSymbolsOf(method);
  return symbols.length > 0 && !symbols.some(symbol => defined.has(symbol));
}

/**
 * Declaration rules of the conditional methods and conditional attribute classes of one source type. Runs after
 * attribute binding.
 * @param {(type: object) => boolean} isAttributeClass
 * @returns {{code: string, args: any[], uri: string, node: object}[]}
 */
export function checkConditionalMethods(type, isAttributeClass = () => true) {
  const results = [];
  const typeUri = type.locations?.[0]?.uri;
  for (const { attribute, argument, symbol } of conditionalAttributes(type)) {
    if (!isAttributeClass(type)) results.push({ code: DiagnosticId.CS1689, args: [attribute.name.toString().trim()], uri: typeUri, node: attribute });
    else if (symbol !== null && !identifier.test(symbol)) results.push({ code: DiagnosticId.CS0633, args: [], uri: typeUri, node: argument });
  }
  for (const member of type.getMembers()) {
    if (member.kind !== SymbolKind.Method || member.isImplicitlyDeclared || member.isAccessor) continue;
    const display = member.toDisplayString(),
      uri = member.uri ?? member.locations?.[0]?.uri;
    for (const { attribute, argument, symbol } of conditionalAttributes(member)) {
      // A constructor is not a target of the attribute: CS0592 from the attribute binder is the whole story.
      if (member.isConstructor) continue;
      const add = (code, args, node = attribute) => results.push({ code, args, uri, node });
      if (type.typeKind === TypeKind.Interface) add(DiagnosticId.CS0582, []);
      else if (member.methodKind !== MethodKind.Ordinary || member.explicitInterfaceSyntax) add(DiagnosticId.CS0577, [display]);
      else if (member.isOverride) add(DiagnosticId.CS0243, []);
      else if (member.returnType && member.returnType.specialType !== 'System_Void') add(DiagnosticId.CS0578, [display]);
      else if (member.parameters.some(parameter => parameter.refKind === RefKind.Out)) add(DiagnosticId.CS0685, [display]);
      if (symbol !== null && !identifier.test(symbol)) add(DiagnosticId.CS0633, [], argument);
    }
  }
  return results;
}

/** Class mixin of the semantic analysis: the conditional-method rules of every source type. */
export const ConditionalMethodChecks = Base =>
  class extends Base {
    checkConditionalMethods() {
      for (const type of this.assembly.types) {
        if (type.typeKind === TypeKind.Enum || type.typeKind === TypeKind.Delegate) continue;
        for (const found of checkConditionalMethods(type, candidate => this.isAttributeClass(candidate)))
          this.report(found.uri, found.node, found.code, found.args);
      }
    }
  };
