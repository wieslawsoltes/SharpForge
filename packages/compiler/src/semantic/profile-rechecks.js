/**
 * Language rules the execution pipeline does not check for programs it compiles (SF-A02-E04).
 *
 * `compile()` runs the semantic analysis only for programs the execution pipeline rejects, because running it for
 * every program would double the compile time. A few C# 1 and 2 rules concern constructs that are inside the execution
 * profile and that the pipeline binds without checking them. `needsSemanticRules` makes the cheap decision whether a
 * program contains such a construct; only then is the analysis consulted, and only the diagnostics listed in
 * `semanticRuleCodes` are taken from it - the image and every other diagnostic of the pipeline stand.
 */
import { needsTopLevelRules } from '../binder/top-level.js';

/** The rules: a source-text filter that is false for almost every program, the syntax that needs the rule, and its codes. */
const rules = [
  {
    // Catch clauses after one that already catches everything: CS0160, CS1017 and the warning CS1058.
    text: /\bcatch\b[^]*\bcatch\b/,
    applies: node => node.kind === 'TryStatement' && node.catches.length > 1,
    codes: ['CS0160', 'CS1017', 'CS1058'],
  },
  {
    // The `field` keyword next to a member named `field` (binder/field-keyword.js): the warning CS9258.
    text: /\bfield\b[^]*\bfield\b/,
    applies: node => node.kind === 'FieldExpression',
    codes: ['CS9258'],
  },
];

/** Rules decided from the compilation unit alone: `{ applies(file), codes }`. */
const unitRules = [
  {
    // Top-level statements: placement, the Program type, the `args` parameter, unused local functions (binder/top-level.js).
    applies: needsTopLevelRules,
    codes: ['CS8937', 'CS0260', 'CS0101', 'CS0136', 'CS8321'],
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
 * True when one of the files has a construct whose rules only the semantic analysis checks.
 * @param {object[]} files parsed files `{ source: { text }, syntax }`
 */
export function needsSemanticRules(files) {
  for (const file of files) {
    if (unitRules.some(rule => rule.applies(file))) return true;
    for (const rule of rules) {
      if (rule.text.test(file.source.text) && contains(file.syntax, rule.applies)) return true;
    }
  }
  return false;
}
