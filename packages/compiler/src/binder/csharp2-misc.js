/**
 * Conditional methods (SF-A02-T52): a call to a method marked `[Conditional("SYMBOL")]` is omitted, together with the
 * evaluation of its arguments, unless one of the method's symbols is defined in the file that contains the call.
 *
 *   - The symbols defined in a file are the `preprocessorSymbols` option plus the file's `#define` directives minus
 *     its `#undef` directives (both are only allowed before the first token, so they hold for the whole file).
 *   - The attribute is recognised by name (`Conditional`, `ConditionalAttribute`, optionally qualified with
 *     `System.Diagnostics`); attributes are not bound to symbols yet (SF-A02-T42), so a user class with that name in
 *     another namespace is taken for the framework attribute.
 *   - Declaration rules: the method returns void (CS0578), is not an interface member (CS0582), an override (CS0243),
 *     a constructor (CS0592), an explicit interface implementation, operator or destructor (CS0577), has no out
 *     parameter (CS0685), and the argument is an identifier (CS0633).
 */
import { SymbolKind, TypeKind, RefKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const attributeNames = new Set(['Conditional', 'ConditionalAttribute']);
const identifier = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*$/u;

function isConditionalName(name) {
  if (name.kind === 'IdentifierName') return attributeNames.has(name.identifier.valueText);
  if (name.kind === 'AliasQualifiedName') return isConditionalName(name.name);
  if (name.kind !== 'QualifiedName' || !isConditionalName(name.right)) return false;
  return name.left.toString().replace(/\s+/g, '').replace(/^global::/, '') === 'System.Diagnostics';
}

/** The `[Conditional(...)]` attributes of a declaration syntax as `[{ attribute, symbol }]`; `symbol` is null when the argument is not a string literal. */
export function conditionalAttributes(declaration) {
  const found = [];
  for (const list of declaration?.attributeLists ?? []) {
    for (const attribute of list.attributes ?? []) {
      if (!isConditionalName(attribute.name)) continue;
      const argument = attribute.argumentList?.arguments?.[0]?.expression,
        text = argument?.kind === 'StringLiteralExpression' ? argument.token?.value : undefined;
      found.push({ attribute, argument: argument ?? null, symbol: typeof text === 'string' ? text : null });
    }
  }
  return found;
}

/** The conditional symbols of a method symbol declared in source (empty for every other method). */
export function conditionalSymbolsOf(method) {
  const definition = method?.originalDefinition ?? method;
  if (!definition?.syntax || definition.kind !== SymbolKind.Method) return [];
  definition.conditionalSymbols ??= conditionalAttributes(definition.syntax)
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
 * Declaration rules of the conditional methods of one source type.
 * @returns {{code: string, args: any[], uri: string, node: object}[]}
 */
export function checkConditionalMethods(type) {
  const results = [];
  for (const member of type.getMembers()) {
    if (member.kind !== SymbolKind.Method || member.isImplicitlyDeclared || member.isAccessor) continue;
    const display = member.toDisplayString(),
      uri = member.uri ?? member.locations?.[0]?.uri;
    for (const { attribute, argument, symbol } of conditionalAttributes(member.syntax)) {
      const add = (code, args, node = attribute) => results.push({ code, args, uri, node });
      if (type.typeKind === TypeKind.Interface) add('CS0582', []);
      // The attribute is declared for methods only; a constructor is not one of its targets.
      else if (member.isConstructor) add('CS0592', ['Conditional', 'method'], attribute.name);
      else if (member.methodKind !== MethodKind.Ordinary || member.explicitInterfaceSyntax) add('CS0577', [display]);
      else if (member.isOverride) add('CS0243', []);
      else if (member.returnType && member.returnType.specialType !== 'System_Void') add('CS0578', [display]);
      else if (member.parameters.some(parameter => parameter.refKind === RefKind.Out)) add('CS0685', [display]);
      if (symbol !== null && !identifier.test(symbol)) add('CS0633', [], argument);
    }
  }
  return results;
}
