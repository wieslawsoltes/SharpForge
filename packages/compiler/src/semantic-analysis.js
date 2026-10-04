/**
 * Semantic analysis over the lossless syntax tree (SF-A02-E01): builds source symbols for every declaration form,
 * checks declarations (inheritance, overrides, interface implementation, generic constraints, variance, structs,
 * readonly and ref struct rules, enums, constants) and binds every body with the type-system modules. It produces
 * Roslyn diagnostics, the symbol table and bound trees; it does not emit code.
 *
 * `Compilation.build` consults it (semantic-integration.js) for programs that use constructs the execution profile
 * cannot run, so that such a program gets the diagnostics a C# compiler would give and - when it is valid C# - one
 * clear "not executable on this runtime profile" diagnostic instead of a miscompilation.
 *
 * The analysis is one class composed from one mixin per phase (./semantic/*.js).
 */
import { AnalysisCore } from './semantic/analysis-core.js';
import { DeclarationChecks } from './semantic/declaration-checks.js';
import { MemberDeclarationChecks, MemberBodyChecks } from './binder/members/declaration-checks.js';
import { ConstantBinding } from './semantic/constants.js';
import { BodyBinding } from './semantic/body-binding.js';
import { TopLevelPrograms } from './binder/top-level.js';
import { UnusedSymbolWarnings } from './semantic/unused-symbols.js';
import { AttributeBinding } from './binder/attributes.js';
import { IndexerNames } from './binder/members/indexer-names.js';
import { CallerInfoChecks } from './binder/caller-info.js';
import { ObsoleteUses } from './binder/obsolete.js';
import { SpecialMemberChecks } from './binder/special-members.js';
import { ComInteropChecks } from './binder/com-interop.js';
import { ConditionalMethodChecks } from './binder/csharp2-misc.js';
import { UnsafeDeclarationChecks } from './binder/unsafe-declarations.js';
import { modernRules, modernUseRules } from './binder/modern-rules.js';

const phases = [
  DeclarationChecks,
  MemberDeclarationChecks,
  ConstantBinding,
  AttributeBinding,
  IndexerNames,
  CallerInfoChecks,
  SpecialMemberChecks,
  ComInteropChecks,
  ConditionalMethodChecks,
  UnsafeDeclarationChecks,
  ...modernRules,
  BodyBinding,
  TopLevelPrograms,
  MemberBodyChecks,
  ObsoleteUses,
  ...modernUseRules,
  UnusedSymbolWarnings,
];

/** `new SemanticAnalysis(files, options).run()` returns `{ diagnostics, incomplete, assembly, bound, core }`. */
export class SemanticAnalysis extends phases.reduce((composed, phase) => phase(composed), AnalysisCore) {}

/**
 * Analyses parsed files.
 * @param {object[]} files `parse()` results (with `syntax`, `source`, `directives`)
 * @param {object} [options] langVersion, langVersionByUri, nullableContext, name, references
 * @returns {{ diagnostics: object[], incomplete: boolean, assembly: object, bound: Map, core: object }}
 */
export function analyze(files, options = {}) {
  return new SemanticAnalysis(files, options).run();
}
