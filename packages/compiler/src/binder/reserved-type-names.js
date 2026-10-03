import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * Type names that became contextual keywords (SF-A02-T12.1): a documented breaking change each time. From the
 * language version that introduced the keyword, a type or type parameter with that name is reported; below it the
 * name is an ordinary identifier and the program compiles as before.
 *
 *   record     C# 9    CS8860 (warning)
 *   required   C# 11   CS9029
 *   scoped     C# 11   CS9062
 *   file       C# 11   CS9056
 *   extension  C# 14   CS9306
 *
 * An escaped name (`@record`) is not reported. Using aliases with these names are not checked here.
 */
const reservedTypeNames = Object.freeze({
  record: { version: 9, code: DiagnosticId.CS8860 },
  required: { version: 11, code: DiagnosticId.CS9029 },
  scoped: { version: 11, code: DiagnosticId.CS9062 },
  file: { version: 11, code: DiagnosticId.CS9056 },
  extension: { version: 14, code: DiagnosticId.CS9306 },
});

/** The rule a declared type name breaks at `version`, or null. `identifier` is the name token as written. */
export function reservedTypeNameRule(identifier, version) {
  const rule = Object.hasOwn(reservedTypeNames, identifier.valueText) ? reservedTypeNames[identifier.valueText] : null;
  return rule && version >= rule.version && !identifier.text.startsWith('@') ? rule : null;
}

/** Class mixin (analysis phase): reports type and type parameter declarations named like a contextual keyword. */
export const ReservedTypeNames = Base =>
  class extends Base {
    checkType(type) {
      super.checkType(type);
      for (const declaration of type.declarations ?? []) {
        const version = this.versionOf(declaration.uri).number,
          names = [declaration.syntax.identifier, ...(declaration.syntax.typeParameterList?.parameters ?? []).map(parameter => parameter.identifier)];
        for (const identifier of names) {
          const rule = identifier ? reservedTypeNameRule(identifier, version) : null;
          if (rule) this.report(declaration.uri, identifier, rule.code);
        }
      }
    }
  };
