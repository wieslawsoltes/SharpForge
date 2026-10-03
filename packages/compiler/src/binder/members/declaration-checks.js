/**
 * The declaration checks of SF-A02-T10 as a phase of the semantic analysis: after the general checks of a type
 * (semantic/declaration-checks.js) every member rule in `memberChecks` runs and its rows are reported.
 * A rule is `type => [{ member, code, args, at? }]`; `at` overrides the location of `member`.
 */
import { checkOperatorDeclarations } from './operator-declarations.js';
import { checkIndexerDeclarations } from './indexer-declarations.js';

/** The member rules, in the order their diagnostics are produced. Add a rule here to have it run for every source type. */
export const memberChecks = [checkIndexerDeclarations, checkOperatorDeclarations];

/** Class mixin (analysis phase): member declaration rules. */
export const MemberDeclarationChecks = Base =>
  class extends Base {
    checkType(type) {
      super.checkType(type);
      for (const check of memberChecks) {
        for (const row of check(type, this.core)) {
          if (row.at) this.report(this.at(row.member).uri, row.at, row.code, row.args);
          else this.reportAt(row.member, row.code, row.args);
        }
      }
    }
  };
