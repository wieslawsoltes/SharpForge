import {DiagnosticId} from '../../diagnostics/codes.js';
/**
 * Uses of partial methods in bodies. A partial method without an implementing part does not exist at run time, so a
 * delegate cannot be created from it (CS0762); calls to it are bound normally and removed by lowering.
 */

/** Class mixin for the body binder: method group conversions of unimplemented partial methods. */
export const PartialMemberBinding = Base =>
  class extends Base {
    groupConversion(group, to) {
      const conversion = super.groupConversion(group, to);
      const target = conversion ? group.methods.find(method => (method.originalDefinition ?? method).isUnimplementedPartial) : null;
      if (target && group.methods.length === 1 && !group.reportedUnimplementedPartial) {
        group.reportedUnimplementedPartial = true;
        this.report(group.syntax ?? group.nameNode, DiagnosticId.CS0762, [target.toDisplayString()]);
      }
      return conversion;
    }
  };
