import { readFile, readdir, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, pin, platform, sha256, requireTarget, resolveToolchain } from './toolchain.js';
import { compileOptions } from './fixtures.js';
import { compileFixture } from './roslyn-compile.js';
import { runFixture } from './clr-run.js';
import { runProcess } from './process.js';

export const cultures = Object.freeze(['invariant', 'fr-FR']);
const families = ['string', 'formatting', 'collections', 'math', 'time'];
const corpusRoot = path.join(root, 'tests/conformance/bcl');

export async function loadCorpus(directory = corpusRoot) {
  const canonicalRoot = await realpath(directory), common = await readFile(path.join(directory, 'Common.cs'));
  if (path.dirname(await realpath(path.join(directory, 'Common.cs'))) !== canonicalRoot) throw new Error('BCL common source escapes corpus');
  const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  if (names.length !== families.length) throw new Error('BCL corpus requires all five families and 200 cases');
  const loaded = [], ids = new Set();
  for (const name of names) {
    if (!families.some(family => name === family + '.json')) throw new Error('Unknown BCL family catalog');
    if (path.dirname(await realpath(path.join(directory, name))) !== canonicalRoot) throw new Error('BCL catalog escapes corpus');
    const catalog = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    if (catalog.schemaVersion !== 1 || name !== catalog.family + '.json' || !/^[A-Z][A-Za-z]+\.cs$/.test(catalog.source ?? '') ||
        !Array.isArray(catalog.cases) || catalog.cases.length !== 40) throw new Error('Each BCL family requires 40 declared cases');
    for (const item of catalog.cases) {
      if (!item || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id ?? '') || !item.id.startsWith(catalog.family + '-') || ids.has(item.id) ||
          !['positive', 'negative', 'boundary'].includes(item.category) ||
          !(item.exception === null || /^System\.[A-Za-z][A-Za-z0-9.]+Exception$/.test(item.exception ?? '')) ||
          (item.category === 'negative' && item.exception === null)) throw new Error('Invalid or duplicate BCL case contract');
      ids.add(item.id);
    }
    const sourcePath = path.join(directory, catalog.source);
    if (path.dirname(await realpath(sourcePath)) !== canonicalRoot) throw new Error('BCL family source escapes corpus');
    const source = await readFile(sourcePath), sourceBytes = Buffer.concat([Buffer.from('\uFEFF'), common, Buffer.from('\n'), source]);
    const sourceSHA256 = sha256(sourceBytes), catalogSHA256 = sha256(JSON.stringify(catalog));
    loaded.push({ ...catalog, id: 'bcl-' + catalog.family, langVersion: '12.0', sourceBytes, sourceSHA256, catalogSHA256,
      inputHash: sha256(JSON.stringify({ sourceName: catalog.source, sourceSHA256, catalogSHA256, langVersion: '12.0', ...compileOptions })) });
  }
  return loaded;
}

export function parseObservations(execution, family, culture) {
  if (!cultures.includes(culture)) throw new Error('Unpinned BCL culture');
  if (!execution || execution.exitCode !== 0 || execution.signal || execution.stderr || execution.unhandledException || typeof execution.stdout !== 'string') {
    throw new Error('BCL native process failed: ' + JSON.stringify(execution));
  }
  const lines = execution.stdout.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== family.cases.length) throw new Error('Incomplete or extra BCL observations');
  return lines.map((line, index) => {
    const row = JSON.parse(line), expected = family.cases[index];
    if (!row || Object.keys(row).sort().join(',') !== 'culture,exception,family,id,status,value' ||
        row.id !== expected.id || row.family !== family.family || row.culture !== culture ||
        row.status !== (expected.exception ? 'exception' : 'returned') || row.exception !== expected.exception ||
        !(row.value === null || typeof row.value === 'string') || (row.exception && row.value !== null)) {
      throw new Error('BCL result contract failed for ' + expected.id + ': ' + line);
    }
    return { ...row, category: expected.category };
  });
}

export async function captureBcl({ directory = corpusRoot, target = platform, resolve = resolveToolchain, compile = compileFixture, execute = runFixture } = {}) {
  const corpus = await loadCorpus(directory), support = requireTarget('coreclr', target);
  const report = { schemaVersion: 1, status: 'running', target, cultures, declaredCases: corpus.reduce((count, family) => count + family.cases.length, 0),
    pinnedToolchain: pin, toolchain: null, families: [], unsupported: [], failures: [] };
  if (!support.supported) { report.status = 'unsupported'; report.unsupported.push(support); return report; }
  try {
    const toolchain = await resolve();
    report.toolchain = { ...toolchain.actual, environment: toolchain.environment };
    for (const family of corpus) {
      const captured = { family: family.family, inputHash: family.inputHash, sourceSHA256: family.sourceSHA256,
        catalogSHA256: family.catalogSHA256, compilation: null, captures: [] };
      report.families.push(captured);
      const compiled = await compile(family, toolchain);
      captured.compilation = { result: compiled.result, timings: compiled.timings, command: compiled.command };
      if (!compiled.assembly || compiled.result.exitCode !== 0 || compiled.result.diagnostics.some(row => row.severity === 'error')) {
        throw new Error('BCL family did not compile: ' + family.family + ': ' + JSON.stringify(compiled.result));
      }
      for (const culture of cultures) {
        const execution = await execute(compiled.assembly, family, toolchain, { env: { SHARPFORGE_BCL_CULTURE: culture, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '0', TZ: 'UTC' } });
        const raw = { culture, inputHash: sha256(JSON.stringify({ familyInputHash: family.inputHash, culture })),
          result: execution.result, timings: execution.timings, command: execution.command };
        captured.captures.push(raw);
        raw.observations = parseObservations(execution.result, family, culture);
      }
    }
    report.status = 'captured-not-baseline-qualified';
  } catch (error) { report.status = 'failed'; report.failures.push(error.message); if (error.result) report.nativeFailure = error.result; }
  return report;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) throw new Error('Usage: bcl-run.js --output NEW_REPORT.json');
  const revision = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root });
  const checkout = await runProcess('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root });
  if (revision.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim()) || checkout.exitCode !== 0) throw new Error('Cannot bind BCL capture to source revision');
  const report = { ...await captureBcl(), commit: revision.stdout.trim(), dirty: checkout.stdout.length !== 0,
    capturedAt: new Date().toISOString(), command: [process.execPath, process.argv[1], ...args] };
  const output = path.resolve(args[1]);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, declaredCases: report.declaredCases, failures: report.failures, output }));
  if (report.status === 'failed') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
