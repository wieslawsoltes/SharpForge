import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './process.js';
import { sha256 } from './toolchain.js';
import { compileOptions } from './fixtures.js';

export function parseDiagnostics(sarif, fixture) {
  return (sarif.runs ?? []).flatMap(run => (run.results ?? []).map(item => {
    const location = item.locations?.[0]?.physicalLocation;
    const region = location?.region;
    return {
      id: item.ruleId,
      severity: item.level ?? 'warning',
      source: location ? fixture.source : null,
      span: region ? { startLine: region.startLine, startColumn: region.startColumn, endLine: region.endLine ?? region.startLine, endColumn: region.endColumn ?? region.startColumn } : null,
    };
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}

export async function compileOnce(fixture, toolchain, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-roslyn-'));
  try {
    const sourcePath = path.join(directory, fixture.source);
    const assemblyPath = path.join(directory, `${compileOptions.assemblyName}.dll`);
    const diagnosticPath = path.join(directory, 'diagnostics.sarif');
    await writeFile(sourcePath, fixture.sourceBytes);
    const args = [toolchain.csc, '/nologo', '/noconfig', '/nostdlib+', '/utf8output', `/deterministic${compileOptions.deterministic ? '+' : '-'}`, compileOptions.debug === 'none' ? '/debug-' : `/debug:${compileOptions.debug}`, `/optimize${compileOptions.optimize ? '+' : '-'}`, `/checked${compileOptions.checked ? '+' : '-'}`, `/nullable:${compileOptions.nullable}`, `/target:${compileOptions.target}`, `/langversion:${fixture.langVersion}`, `/pathmap:${directory}=${compileOptions.pathMap}`, `/out:${assemblyPath}`, `/errorlog:${diagnosticPath},version=2.1`, ...toolchain.references.map(file => `/reference:${file}`), sourcePath];
    const processResult = await runProcess(toolchain.dotnet, args, { cwd: directory, ...options });
    if (processResult.signal || ![0, 1].includes(processResult.exitCode)) throw new Error(`Roslyn process failed: ${JSON.stringify(processResult)}`);
    const diagnostics = parseDiagnostics(JSON.parse(await readFile(diagnosticPath, 'utf8')), fixture);
    const assembly = processResult.exitCode === 0 ? await readFile(assemblyPath) : null;
    return {
      result: { exitCode: processResult.exitCode, diagnostics, assemblySHA256: assembly ? sha256(assembly) : null },
      assembly, elapsedMs: processResult.elapsedMs,
      command: [toolchain.dotnet, ...args.map(arg => arg.replaceAll(directory, '<temporary>'))],
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function assertDeterministic(first, second, label) {
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error(`Nondeterministic ${label}: ${JSON.stringify({ first, second })}`);
}

export async function compileFixture(fixture, toolchain, options) {
  const first = await compileOnce(fixture, toolchain, options);
  const second = await compileOnce(fixture, toolchain, options);
  assertDeterministic(first.result, second.result, `Roslyn fixture ${fixture.id}`);
  return { ...first, timings: [first.elapsedMs, second.elapsedMs] };
}
