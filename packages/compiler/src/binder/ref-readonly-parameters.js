/**
 * `ref readonly` parameters at the call site (C# 12, SF-A02-T80). The parameter takes a reference to a variable the
 * callee does not write; the argument says how it is passed, and anything but `ref` or `in` on a variable is a warning:
 *
 *   CS9192  the argument is a variable passed without `ref` or `in`
 *   CS9193  the argument is a value (a temporary is passed)
 *   CS9191  `ref` for an `in` parameter (allowed from C# 12; the error CS9194 below it)
 *
 * `out` for a `ref readonly` parameter is CS1615 (overload/resolution.js), a default value on the parameter is the
 * warning CS9200 (binder/members/basic-declarations.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { classifyVariable } from './ref-kinds.js';

/** Class mixin of the body binder. */
export const RefReadonlyParameterBinding = Base =>
  class extends Base {
    finishCall(result, receiver, args, syntax, options = {}) {
      const call = super.finishCall(result, receiver, args, syntax, options),
        parameters = result.method?.parameters ?? [];
      args.forEach((argument, index) => {
        const parameter = parameters[result.mapping?.parameterOf?.[index] ?? index];
        if (!parameter || argument.hasErrors) return;
        const given = argument.refKind ?? RefKind.None;
        if (parameter.refKind === RefKind.RefReadOnlyParameter && given === RefKind.None) {
          const isVariable = classifyVariable(argument, this.variableContext).isVariable;
          this.report(argument.syntax, isVariable ? DiagnosticId.CS9192 : DiagnosticId.CS9193, [index + 1]);
        } else if (parameter.refKind === RefKind.In && given === RefKind.Ref) {
          const version = this.version.number;
          if (version >= 12) this.report(argument.syntax, DiagnosticId.CS9191, [index + 1]);
          else this.report(argument.syntax, DiagnosticId.CS9194, [index + 1, Number.isInteger(version) ? version + '.0' : String(version), '12.0']);
        }
      });
      return call;
    }
  };
