/**
 * Feature-level conformance report (SF-A02-T12.2).
 *
 *   node packages/compiler/test/conformance/report.js [--json <file>] [--markdown <file>]
 *
 * One row per row of the language feature catalog (packages/syntax/src/features.js), so syntax and semantic results
 * share one feature id. Columns:
 *
 *   parse     the catalog snippet of the feature (./feature-snippets.js) parses without a syntax error
 *   bind      Roslyn-pinned fixtures of the differential corpus that use the feature get exactly Roslyn's errors
 *             (output and diagnostics fixtures); the detail says what the semantic analysis makes of the snippet
 *   bytecode  Roslyn-pinned output fixtures of the differential corpus that use the feature print what .NET prints
 *   cil       the same on the CIL back end
 *   gate      one language version below, the feature's "not available" diagnostic is reported; at its own
 *             version it is not
 *
 * Which fixtures use a feature is not declared by hand: every output fixture is parsed and the features the parser
 * and the syntax walker record for it are the features it executes (./fixture-features.js adds the few that only
 * binding can see). A cell is `pass`, `partial` (some fixtures pass, some do not), `fail`, `unsupported` or `n/a`
 * (C# 1 has no version gate).
 *
 * The rule the report exists for: **a feature with no executed fixture is `unsupported`, never `pass`**. A bind or
 * execution cell is `pass` only when at least one fixture that uses the feature ran and matched, and none failed.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse, languageFeatures, previousLanguageVersion } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../../src/semantic-analysis.js';
import { collectSyntaxFeatures } from '../../src/binder/syntax-features.js';
import { featureSnippets } from './feature-snippets.js';
import { semanticFixtureFeatures } from './fixture-features.js';
import { report as differentialReport } from '../differential/harness.js';
import { loadFixtures } from '../differential/corpus-store.js';

/** The cell values, from best to worst. */
export const STATUS = Object.freeze({ pass: 'pass', partial: 'partial', fail: 'fail', unsupported: 'unsupported', notApplicable: 'n/a' });
/** The columns of a row, in report order. */
export const COLUMNS = Object.freeze(['parse', 'bind', 'bytecode', 'cil', 'gate']);

const versionText = version => (version === 15 ? 'preview' : String(version));
const errorsOf = diagnostics => diagnostics.filter(d => d.severity === 'error');
const parseSnippet = source => parse(new SourceText(source, 'Program.cs'), undefined, { languageVersion: 'preview' });

/** The catalog feature ids a source uses, as the parser and the syntax walker record them. */
export function featuresUsedBy(source, langVersion = null) {
  const file = parse(new SourceText(source, 'Program.cs'), undefined, langVersion ? { languageVersion: langVersion } : {}),
    ids = new Set((file.features ?? []).map(use => use.id));
  if (file.syntax) for (const use of collectSyntaxFeatures(file.syntax)) ids.add(use.id);
  return ids;
}

/**
 * Per feature id, the fixtures that use it: `Map<id, {bind, bytecode, cil: {passed, failed}, fixtures: string[]}>`
 * (`bind` counts all fixtures on the errors axis; `bytecode`, `cil` and `fixtures` count the executed output fixtures).
 * @param {object[]} fixtures the differential fixtures  @param {object[]} rows the rows of a differential `report()`
 */
export function executionsByFeature(fixtures, rows) {
  const byId = new Map(rows.map(row => [row.id, row])),
    executions = new Map();
  const note = (featureId, row) => {
    let entry = executions.get(featureId);
    if (!entry) {
      entry = { bind: { passed: 0, failed: 0 }, bytecode: { passed: 0, failed: 0 }, cil: { passed: 0, failed: 0 }, fixtures: [] };
      executions.set(featureId, entry);
    }
    entry.bind[row.diagnostics === true ? 'passed' : 'failed']++;
    if (row.kind !== 'output') return;
    entry.fixtures.push(row.id);
    for (const axis of ['bytecode', 'cil']) entry[axis][row[axis] === true ? 'passed' : 'failed']++;
  };
  for (const fixture of fixtures) {
    const row = byId.get(fixture.id);
    // Every fixture counts for binding; only output fixtures are executed (see `note`).
    if (!row) continue;
    const used = featuresUsedBy(fixture.source, fixture.langVersion ?? null);
    for (const [featureId, differentialFeatures] of Object.entries(semanticFixtureFeatures))
      if (differentialFeatures.includes(fixture.feature)) used.add(featureId);
    for (const featureId of used) note(featureId, row);
  }
  return executions;
}

/** A fixture-backed cell: never `pass` without a fixture that ran and matched. */
export function executionStatus(counts) {
  if (!counts || counts.passed + counts.failed === 0) return STATUS.unsupported;
  if (counts.failed === 0) return STATUS.pass;
  return counts.passed > 0 ? STATUS.partial : STATUS.fail;
}

function parseStatus(row) {
  const source = featureSnippets[row.id];
  if (source === undefined) return { status: STATUS.unsupported, detail: 'no snippet' };
  // Profile restrictions of the legacy adapter (SF1xxx) are not syntax errors; an unsupported preview form (SF1098) is.
  const errors = errorsOf(parseSnippet(source).diagnostics).filter(d => /^CS/.test(d.code) || d.code === 'SF1098');
  return errors.length ? { status: STATUS.fail, detail: errors[0].code } : { status: STATUS.pass };
}

/** What the semantic analysis makes of the catalog snippet at the feature's own version (the detail of the bind cell). */
function snippetAnalysis(row) {
  const source = featureSnippets[row.id];
  if (source === undefined) return 'no snippet';
  const file = parseSnippet(source);
  try {
    const result = analyze([file], { langVersion: versionText(row.version) });
    if (result.unsupported) return 'snippet: not analysed';
    const errors = errorsOf(result.diagnostics);
    if (errors.length) return 'snippet: ' + [...new Set(errors.map(d => d.code))].join(' ');
    return result.incomplete ? 'snippet: bound with members the framework registry lacks' : 'snippet: no errors';
  } catch (error) {
    return 'snippet: analysis failed: ' + String(error?.message ?? error).split('\n')[0];
  }
}

function bindStatus(row, counts) {
  return { status: executionStatus(counts), detail: snippetAnalysis(row) };
}

function gateStatus(row) {
  const below = previousLanguageVersion(row.version);
  if (below === null || below === undefined) return { status: STATUS.notApplicable };
  const source = featureSnippets[row.id];
  if (source === undefined || !row.code) return { status: STATUS.unsupported, detail: 'no snippet or no gate code' };
  const gates = version => {
    try {
      return compile([parseSnippet(source)], { langVersion: versionText(version) }).diagnostics.filter(d => d.code === row.code);
    } catch {
      return null;
    }
  };
  const low = gates(below),
    own = gates(row.version);
  if (low === null || own === null) return { status: STATUS.fail, detail: 'compile failed' };
  if (!low.length) return { status: STATUS.unsupported, detail: `no ${row.code} at ${versionText(below)}` };
  return own.length ? { status: STATUS.fail, detail: `${row.code} also at ${versionText(row.version)}` } : { status: STATUS.pass };
}

/**
 * Builds the report.
 * @param {{fixtures?: object[], differential?: {fixtures: object[], roslyn?: object}, features?: object[]}} [options]
 *   the differential fixtures and their `report()` result (run when omitted) and the catalog rows
 * @returns {{roslyn: object|null, columns: string[], totals: object, rows: object[]}}
 */
export function conformanceReport(options = {}) {
  const fixtures = options.fixtures ?? loadFixtures(),
    differential = options.differential ?? differentialReport({ fixtures }),
    executions = executionsByFeature(fixtures, differential.fixtures),
    rows = (options.features ?? languageFeatures).map(row => {
      const executed = executions.get(row.id),
        cells = {
          parse: parseStatus(row),
          bind: bindStatus(row, executed?.bind),
          bytecode: { status: executionStatus(executed?.bytecode) },
          cil: { status: executionStatus(executed?.cil) },
          gate: gateStatus(row),
        };
      return {
        id: row.id,
        name: row.name,
        version: versionText(row.version),
        preview: row.preview,
        ...Object.fromEntries(COLUMNS.map(column => [column, cells[column].status])),
        details: Object.fromEntries(COLUMNS.filter(column => cells[column].detail).map(column => [column, cells[column].detail])),
        executedFixtures: executed?.fixtures.length ?? 0,
        bindFixtures: executed?.bind ?? { passed: 0, failed: 0 },
        bytecodeFixtures: executed?.bytecode ?? { passed: 0, failed: 0 },
        cilFixtures: executed?.cil ?? { passed: 0, failed: 0 },
      };
    });
  const totals = Object.fromEntries(
    COLUMNS.map(column => [column, Object.fromEntries(Object.values(STATUS).map(status => [status, rows.filter(row => row[column] === status).length]))]),
  );
  return { roslyn: differential.roslyn ?? null, columns: [...COLUMNS], totals, rows };
}

/** The report as a markdown document: totals, then one table row per feature in catalog order. */
export function formatMarkdown(report) {
  const lines = [
    '# C# feature conformance',
    '',
    `Generated by \`packages/compiler/test/conformance/report.js\` against Roslyn ${report.roslyn?.informationalVersion ?? report.roslyn?.version ?? '?'}.`,
    'A bind or execution cell is `pass` only when a Roslyn-pinned fixture that uses the feature ran and matched; a feature without one is `unsupported`.',
    'Preview (C# 15) rows are provisional: they follow pinned csharplang proposal revisions.',
    '',
    '| column | ' + Object.values(STATUS).join(' | ') + ' |',
    '|---|' + Object.values(STATUS).map(() => '---:').join('|') + '|',
    ...report.columns.map(column => `| ${column} | ` + Object.values(STATUS).map(status => report.totals[column][status]).join(' | ') + ' |'),
    '',
    '| C# | feature | id | parse | bind | bytecode | cil | gate | executed fixtures |',
    '|---|---|---|---|---|---|---|---|---:|',
    ...report.rows.map(
      row =>
        `| ${row.version} | ${row.name} | \`${row.id}\` | ${row.parse} | ${row.bind} | ${row.bytecode} | ${row.cil} | ${row.gate} | ${row.executedFixtures} |`,
    ),
  ];
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2),
    option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null),
    report = conformanceReport(),
    markdown = formatMarkdown(report);
  if (option('--json')) writeFileSync(option('--json'), JSON.stringify(report, null, 2) + '\n');
  if (option('--markdown')) writeFileSync(option('--markdown'), markdown);
  if (!option('--json') && !option('--markdown')) process.stdout.write(markdown);
}
