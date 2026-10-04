/**
 * Compares the semantic analysis (packages/compiler/src/semantic-analysis.js) with the pinned Roslyn results, on its
 * own - without the execution pipeline. For every fixture: the error set must equal Roslyn's (an output fixture must
 * have none) and, with --warnings, the warning set too.
 *
 *   node packages/compiler/test/differential/tools/semantic-report.mjs [--warnings] [--verbose] [filter]
 */
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../../../src/semantic-analysis.js';
import { loadFixtures, loadPinned } from '../corpus-store.js';

const args = process.argv.slice(2),
  withWarnings = args.includes('--warnings'),
  verbose = args.includes('--verbose'),
  filter = args.find(a => !a.startsWith('--')) ?? '';
const key = d => `${d[0]}@${d[1]}+${d[2]}`;
export function semanticRow(fixture, pinned) {
  const file = parse(
    new SourceText(fixture.source, 'Program.cs'),
    undefined,
    fixture.langVersion ? { languageVersion: fixture.langVersion } : {},
  );
  let result;
  try {
    // The same options the harness and the pinning tool compile a fixture with.
    result = analyze([file], { ...(fixture.langVersion ? { langVersion: fixture.langVersion } : {}), ...(fixture.allowUnsafe ? { allowUnsafe: true } : {}) });
  } catch (error) {
    return { id: fixture.id, crash: String(error.stack).split('\n').slice(0, 4).join(' | ') };
  }
  if (result.unsupported) return { id: fixture.id, kind: fixture.kind, ok: false, unsupported: true, details: [] };
  const all = [
    ...file.diagnostics.filter(
      d =>
        /^CS/.test(d.code) &&
        !(d.code === 'CS1014' && /init is not supported/.test(d.message)) &&
        !(d.code === 'CS0528' && /IDisposable/.test(d.message)),
    ),
    ...result.diagnostics,
  ].map(d => [d.code, d.start, d.length, d.severity]);
  const unlocated = new Set(pinned.diagnostics.filter(d => d[1] < 0).map(d => d[0])),
    norm = rows => rows.map(d => (unlocated.has(d[0]) ? [d[0], -1, 0, d[3]] : d));
  const row = { id: fixture.id, kind: fixture.kind, incomplete: result.incomplete, ok: true, details: [] };
  for (const severity of withWarnings ? ['error', 'warning'] : ['error']) {
    const want = [
        ...new Set(
          norm(pinned.diagnostics)
            .filter(d => d[3] === severity)
            .map(key),
        ),
      ].sort(),
      got = [
        ...new Set(
          norm(all)
            .filter(d => d[3] === severity)
            .map(key),
        ),
      ].sort();
    const missing = want.filter(k => !got.includes(k)),
      unexpected = got.filter(k => !want.includes(k));
    if (missing.length || unexpected.length) {
      row.ok = false;
      row.details.push({
        severity,
        missing,
        unexpected,
        messages: result.diagnostics.filter(d => unexpected.includes(key([d.code, d.start, d.length]))).map(d => d.message),
      });
    }
  }
  return row;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const fixtures = loadFixtures().filter(f => f.id.includes(filter)),
    pinned = loadPinned().results;
  let ok = 0,
    falsePositives = 0,
    crashes = 0;
  for (const f of fixtures) {
    const row = semanticRow(f, pinned.get(f.id));
    if (row.crash) {
      crashes++;
      console.log('CRASH', f.id, row.crash);
      continue;
    }
    if (row.ok) {
      ok++;
      continue;
    }
    const fp = f.kind === 'output' && row.details.some(d => d.severity === 'error' && d.unexpected.length);
    if (fp) falsePositives++;
    if (verbose || fp || filter)
      console.log((fp ? 'FALSE-POSITIVE ' : 'mismatch ') + f.id + (row.incomplete ? ' (incomplete)' : ''), JSON.stringify(row.details));
  }
  console.log(
    `semantic analysis: ${ok}/${fixtures.length} fixtures match Roslyn${withWarnings ? ' (errors and warnings)' : ' (errors)'}; ` +
      `${falsePositives} valid programs with false errors; ${crashes} crashes`,
  );
}
