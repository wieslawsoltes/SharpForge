/**
 * The declaration checks of SF-A02-T10 as a phase of the semantic analysis: after the general checks of a type
 * (semantic/declaration-checks.js) every member rule in `memberChecks` runs and its rows are reported.
 * A rule is `type => [{ member, code, args, at? }]`; `at` overrides the location of `member`.
 */
import { checkExtensionDeclarations } from '../extension-methods.js';
import { checkMemberBodies } from '../member-bodies.js';
import { checkOperatorDeclarations } from './operator-declarations.js';
import { checkIndexerDeclarations } from './indexer-declarations.js';
import { checkRequiredDeclarations, chainingProblem } from './required-members.js';
import { checkInitAccessors } from './init-accessors.js';
import {
  checkPropertyDeclarations,
  checkConstantDeclarations,
  checkStaticConstructorDeclarations,
  checkParameterDeclarations,
} from './basic-declarations.js';
import { checkPrimaryConstructorChaining, primaryParameterWarnings } from './primary-constructors.js';

/** The member rules, in the order their diagnostics are produced. Add a rule here to have it run for every source type. */
export const memberChecks = [
  checkPropertyDeclarations,
  checkConstantDeclarations,
  checkStaticConstructorDeclarations,
  checkParameterDeclarations,
  checkIndexerDeclarations,
  checkOperatorDeclarations,
  checkInitAccessors,
  checkRequiredDeclarations,
  checkPrimaryConstructorChaining,
  checkExtensionDeclarations,
  checkMemberBodies,
];

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

/** Class mixin (analysis phase, after body binding): rules that need the bound constructor initializers. */
export const MemberBodyChecks = Base =>
  class extends Base {
    bindBodies() {
      super.bindBodies();
      // Whether a primary constructor parameter is read or captured is known once every body is bound.
      const initializers = new Map();
      for (const [member, bound] of this.bound) {
        const type = bound?.kind === 'Initializer' ? member.containingType : null;
        if (type?.primaryConstructor) initializers.set(type, [...(initializers.get(type) ?? []), bound]);
      }
      for (const type of this.assembly.types) {
        if (!type.primaryConstructor) continue;
        const uri = this.at(type).uri;
        for (const row of primaryParameterWarnings(type, initializers.get(type) ?? [])) this.report(uri, row.at, row.code, row.args);
      }
    }
    bindConstructorInitializer(ctor, type, binder) {
      super.bindConstructorInitializer(ctor, type, binder);
      const problem = chainingProblem(ctor);
      if (problem) this.report(this.at(ctor).uri, problem.at ?? this.at(ctor), problem.code, problem.args);
    }
  };
