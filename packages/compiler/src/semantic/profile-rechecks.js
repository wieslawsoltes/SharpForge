/**
 * Language rules the execution pipeline does not check for programs it compiles (SF-A02-E04).
 *
 * `compile()` runs the semantic analysis only for programs the execution pipeline rejects, because running it for
 * every program would double the compile time. A few C# 1 and 2 rules concern constructs that are inside the execution
 * profile and that the pipeline binds without checking them. `needsSemanticRules` makes the cheap decision whether a
 * program contains such a construct; only then is the analysis consulted, and only the diagnostics listed in
 * `semanticRuleCodes` are taken from it - the image and every other diagnostic of the pipeline stand.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { needsTopLevelRules } from '../binder/top-level.js';

/** The rules: a source-text filter that is false for almost every program, the syntax that needs the rule, and its codes. */
const rules = [
  {
    // Catch clauses after one that already catches everything: CS0160, CS1017 and the warning CS1058.
    text: /\bcatch\b[^]*\bcatch\b/,
    applies: node => node.kind === 'TryStatement' && node.catches.length > 1,
    codes: [DiagnosticId.CS0160, DiagnosticId.CS1017, DiagnosticId.CS1058],
  },
  {
    // Labeled break and continue (binder/labeled-jumps.js): the target rules of the pinned preview proposal.
    text: /\b(?:break|continue)\s+[\p{L}_@]/u,
    applies: node => (node.kind === 'BreakStatement' || node.kind === 'ContinueStatement') && !!node.label,
    codes: [DiagnosticId.CS0139, DiagnosticId.CS0157],
  },
  {
    // The `field` keyword next to a member named `field` (binder/field-keyword.js): the warning CS9258.
    text: /\bfield\b[^]*\bfield\b/,
    applies: node => node.kind === 'FieldExpression',
    codes: [DiagnosticId.CS9258],
  },
  {
    // A type named like a contextual keyword (binder/reserved-type-names.js): the rule depends on the language version.
    text: /\b(?:class|struct|interface|enum|delegate)\b[^;{(]*\b(?:record|required|scoped|file|extension)\b/,
    applies: node => !!node.identifier && typeDeclarationKinds.has(node.kind) && reservedNames.has(node.identifier.valueText),
    codes: [DiagnosticId.CS8860, DiagnosticId.CS9029, DiagnosticId.CS9062, DiagnosticId.CS9056, DiagnosticId.CS9306],
  },
  {
    // An interpolation alignment beyond 32767 (binder/csharp6.js): the warning CS8094. Only a literal of five digits
    // or more can be out of range without leaving the profile (a constant expression is bound by the analysis anyway).
    text: /,\s*-?\s*\d{5,}\s*[:}]/,
    applies: node => !!node.alignmentClause,
    codes: [DiagnosticId.CS8094],
  },
  {
    // A type (or alias) named `var`: `var x = e;` then declares a variable of that type instead of inferring one, which
    // the execution pipeline does not know. The conversion errors of such declarations come from the analysis.
    text: /\b(?:class|struct|interface|enum|record)\s+var\b|\bdelegate\b[^;(]*\bvar\s*[<(]|\busing\s+var\s*=/,
    applies: node =>
      (typeDeclarationKinds.has(node.kind) && node.identifier?.valueText === 'var') ||
      (node.kind === 'UsingDirective' && node.alias?.name?.identifier?.valueText === 'var'),
    codes: [DiagnosticId.CS0029, DiagnosticId.CS0266, DiagnosticId.CS0037],
  },
  {
    // A switch expression (flow/pattern-exhaustiveness.js): arms that can never be chosen and values no arm handles.
    text: /\bswitch\s*\{/,
    applies: node => node.kind === 'SwitchExpression',
    codes: [DiagnosticId.CS8509, DiagnosticId.CS8510, DiagnosticId.CS8524, DiagnosticId.CS8846],
  },
  {
    // C# 15 preview `closed` types (binder/preview-features.js): the provisional rules of the pinned proposals.
    text: /\bclosed\s+(?:class|enum)\b/,
    applies: node => (node.kind === 'ClassDeclaration' || node.kind === 'EnumDeclaration') && (node.modifiers ?? []).some(token => token.text === 'closed'),
    codes: [DiagnosticId.SF2203],
  },
];
const typeDeclarationKinds = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'EnumDeclaration', 'DelegateDeclaration']);
const nullableWarningContexts = new Set(['enable', 'warnings']);
const reservedNames = new Set(['record', 'required', 'scoped', 'file', 'extension']);

/** The warnings of the nullable flow analysis and of the nullable signature checks (packages/compiler/src/nullable). */
const nullableWarnings = [
  DiagnosticId.CS8597,
  DiagnosticId.CS8600,
  DiagnosticId.CS8601,
  DiagnosticId.CS8602,
  DiagnosticId.CS8603,
  DiagnosticId.CS8604,
  DiagnosticId.CS8605,
  DiagnosticId.CS8618,
  DiagnosticId.CS8625,
];
const enablesNullable = /^[ \t]*#[ \t]*nullable[ \t]+(?:enable|restore)\b/m;

/** Rules decided from the compilation unit alone: `{ applies(file, options), codes }`. */
const unitRules = [
  {
    // A nullable warning context: the execution pipeline has no null-state analysis, so a program without a single
    // annotation (`string t = o.ToString();`) would compile without the warnings it has.
    applies: (file, options) => enablesNullable.test(file.source.text) || nullableWarningContexts.has(options.nullableContext),
    codes: nullableWarnings,
  },
  {
    // Top-level statements: placement, the Program type, the `args` parameter, unused local functions (binder/top-level.js).
    applies: needsTopLevelRules,
    codes: [DiagnosticId.CS8937, DiagnosticId.CS0260, DiagnosticId.CS0101, DiagnosticId.CS0136, DiagnosticId.CS8321],
  },
];

/** Diagnostic codes taken from the semantic analysis of a program the execution pipeline compiled. */
export const semanticRuleCodes = new Set([...rules, ...unitRules].flatMap(rule => rule.codes));

function contains(node, applies) {
  if (applies(node)) return true;
  for (const child of node.childNodes()) if (contains(child, applies)) return true;
  return false;
}

/**
 * The diagnostic codes to take from the semantic analysis for these files: those of the rules whose construct one of
 * the files has. Empty for almost every program, which is then not analysed at all.
 * @param {object[]} files parsed files `{ source: { text }, syntax }`
 * @param {{nullableContext?: string}} [options] the compilation options the rules depend on
 * @returns {Set<string>}
 */
export function applicableRuleCodes(files, options = {}) {
  const codes = new Set(),
    take = rule => rule.codes.forEach(code => codes.add(code));
  for (const file of files) {
    for (const rule of unitRules) if (rule.applies(file, options)) take(rule);
    for (const rule of rules) if (rule.text.test(file.source.text) && contains(file.syntax, rule.applies)) take(rule);
  }
  return codes;
}

/** True when one of the files has a construct whose rules only the semantic analysis checks. */
export const needsSemanticRules = files => applicableRuleCodes(files).size > 0;
