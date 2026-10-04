/**
 * Protected members reached through a receiver (SF-A02-T49, C# spec 7.5.4): inside a class D, a protected instance
 * member of a base class is only accessible through an expression of type D or a class derived from D. Through any
 * other type the access is CS1540, which names the member, the type it was reached through and the accessing class;
 * a member that is inaccessible for any other reason stays CS0122 (or CS0272 for a set accessor).
 *
 * The rule itself is `checkAccess` in ./accessibility.js; this mixin reports it at the places the body binder finds
 * an inaccessible member: member access, assignment through a less accessible set accessor, and indexer access.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { checkAccess } from './accessibility.js';

/** Class mixin of the body binder: diagnostics for members that are not accessible from the code being bound. */
export const ProtectedAccessBinding = Base =>
  class extends Base {
    accessProblem(member, throughType) {
      const within = this.c.containingType?.originalDefinition ?? null;
      return checkAccess(member.originalDefinition ?? member, within, { throughType, withinModule: this.d.assembly.module });
    }
    /** Reports an inaccessible member found by a lookup through a value of `throughType`. */
    reportInaccessible(member, throughType, node) {
      const problem = this.accessProblem(member, throughType);
      this.report(node, problem?.code ?? DiagnosticId.CS0122, problem?.args ?? [member.toDisplayString()]);
    }
    /** Reports a write through a set accessor that is not accessible here: CS1540 through the wrong type, else CS0272. */
    reportInaccessibleSetter(target, node) {
      const problem = this.accessProblem(target.property.setMethod, target.receiver?.type ?? null);
      if (problem?.code === DiagnosticId.CS1540) this.report(node, problem.code, problem.args);
      else this.report(node, DiagnosticId.CS0272, [target.property.toDisplayString()]);
    }
    /** Reports a member that overload resolution chose although it is not accessible through `throughType`; true when reported. */
    reportIfInaccessible(member, throughType, node) {
      const problem = this.accessProblem(member, throughType);
      if (problem) this.report(node, problem.code, problem.args);
      return !!problem;
    }
  };
