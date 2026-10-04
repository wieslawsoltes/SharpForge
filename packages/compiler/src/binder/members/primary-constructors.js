/**
 * Primary constructors of classes and structs (C# 12, SF-A02-T10.5).
 *
 * The parameters are in scope in the whole type body. Initializers and base arguments read the parameter itself
 * (they run inside the constructor). An instance member that names one captures it into the state of the type; a
 * member of the same name wins over the parameter there. Bound uses in members are `Parameter` nodes flagged
 * `isPrimaryCapture`, and the parameter symbol is marked `capturedByType`.
 *
 *   CS9105  use in a static member or in a nested type      CS9109  capture of a ref, out or in parameter
 *   CS9113  a parameter nothing reads (warning)             CS9124  captured and also copied by an initializer (warning)
 *   CS8862  another constructor that does not chain to `this(...)`
 *   CS1604  assignment in a readonly member of a struct     CS9114  assignment in a readonly struct
 *   CS0229  two parameters of the same name used
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, RefKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { lookupMembers } from '../inheritance.js';

const isPrimaryParameter = symbol => symbol?.kind === SymbolKind.Parameter && !!symbol.containingSymbol?.isPrimaryConstructor;

/** Class mixin for the body binder: primary constructor parameters as names in member bodies. */
export const PrimaryConstructorBinding = Base =>
  class extends Base {
    identifier(syntax, options = {}) {
      const captured = this.primaryParameterUse(syntax);
      if (captured) return captured;
      const bound = super.identifier(syntax, options);
      // A use the ordinary lookup found is in an initializer or a base argument: it reads the parameter itself.
      if (bound.kind === 'Parameter' && isPrimaryParameter(bound.parameter)) bound.parameter.readByInitializer = true;
      return bound;
    }
    /** The node for a name that resolves to a primary constructor parameter of an enclosing type, or null. */
    primaryParameterUse(syntax) {
      const name = syntax.identifier.valueText;
      if (syntax.identifier.isMissing || this.typeArgumentsOf(syntax)?.length || this.lookupLocal(name) || this.isPending(name)) return null;
      for (let type = this.c.containingType, innermost = true; type; type = type.containingType, innermost = false) {
        const members = lookupMembers(type, name, this.core, { within: this.c.containingType });
        if (members.members.length || members.inaccessible.length) return null;
        const parameters = type.primaryConstructor && !type.isRecord ? type.primaryConstructor.parameters.filter(p => p.name === name) : [];
        if (parameters.length) return this.capturePrimaryParameter(parameters, syntax, innermost);
      }
      return null;
    }
    capturePrimaryParameter(parameters, syntax, innermost) {
      const [parameter] = parameters;
      // A rejected use is still a use: it does not leave the parameter unread.
      for (const used of parameters) used.usedByMember = true;
      if (parameters.length > 1) {
        this.report(syntax, DiagnosticId.CS0229, parameters.slice(0, 2).map(p => p.toDisplayString()));
        return this.bad(syntax);
      }
      if (!innermost || this.c.isStatic) {
        this.report(syntax, DiagnosticId.CS9105, [parameter.toDisplayString()]);
        return this.bad(syntax);
      }
      if (parameter.refKind !== RefKind.None) {
        this.report(syntax, DiagnosticId.CS9109, [parameter.toDisplayString()]);
        return this.bad(syntax);
      }
      parameter.capturedByType = true;
      return this.node('Parameter', syntax, parameter.type, { parameter, isPrimaryCapture: true });
    }
    markWrite(target, value) {
      if (target.kind === 'Parameter' && target.isPrimaryCapture) {
        const type = this.c.containingType,
          name = target.parameter.toDisplayString();
        if (type?.typeKind === TypeKind.Struct && type.isReadOnly) this.report(target.syntax, DiagnosticId.CS9114, []);
        else if (type?.typeKind === TypeKind.Struct && this.c.method?.isReadOnly) this.report(target.syntax, DiagnosticId.CS1604, [name]);
      }
      return super.markWrite(target, value);
    }
  };

/** CS8862: in a type with a primary constructor every other instance constructor chains to `this(...)`. */
export function checkPrimaryConstructorChaining(type) {
  if (!type.primaryConstructor) return [];
  const rows = [];
  for (const constructor of type.getMembers('.ctor')) {
    if (constructor.methodKind !== MethodKind.Constructor || constructor.isPrimaryConstructor || constructor.isImplicitlyDeclared) continue;
    if (constructor.isCopyConstructor || constructor.initializerSyntax?.kind === 'ThisConstructorInitializer') continue;
    rows.push({ member: constructor, code: DiagnosticId.CS8862, args: [], at: constructor.initializerSyntax?.thisOrBaseKeyword ?? null });
  }
  return rows;
}

const withoutConversions = node => {
  let current = node;
  while (current?.kind === 'Conversion') current = current.operand;
  return current;
};

/**
 * The warnings that need every body of the type bound: CS9113 for a parameter nothing reads, CS9124 for a captured
 * parameter an initializer also copies. `initializers` are the bound initializers of the type's members.
 * @returns {{at: object, code: string, args: any[]}[]}
 */
export function primaryParameterWarnings(type, initializers) {
  const constructor = type.primaryConstructor;
  if (!constructor || type.isRecord) return [];
  const rows = [];
  for (const parameter of constructor.parameters) {
    if (!parameter.usedByMember && !parameter.readByInitializer && parameter.locations?.[0])
      rows.push({ at: parameter.locations[0], code: DiagnosticId.CS9113, args: [parameter.name] });
  }
  for (const bound of initializers) {
    const value = withoutConversions(bound.expression);
    if (value?.kind === 'Parameter' && isPrimaryParameter(value.parameter) && value.parameter.capturedByType)
      rows.push({ at: value.syntax, code: DiagnosticId.CS9124, args: [value.parameter.name] });
  }
  return rows;
}
