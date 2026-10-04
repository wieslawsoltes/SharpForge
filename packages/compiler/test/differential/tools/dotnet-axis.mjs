/**
 * The real-.NET axes of the differential corpus (SF-A02-T30): every output fixture is compiled with
 * `compileToAssembly`, the emitted assembly runs on the installed .NET runtime, and its output is compared with the
 * pinned Roslyn result. Two columns:
 *
 *   registry    bound against the closed framework registry (the default of the compiler)
 *   references  bound against the reference pack of the installed SDK (`references` option)
 *
 *   node packages/compiler/test/differential/tools/dotnet-axis.mjs [--update] [--filter <text>] [--verbose]
 *                                                                [--column registry|references] [--dotnet <path>]
 *
 * The fixtures that pass are recorded in `../dotnet-baseline.json`; a run fails when a recorded fixture stops passing
 * and `--update` rewrites the file. Pinned Roslyn results are never touched. Needs a .NET SDK, so it is a tool and
 * not a unit test: `tests/compiler-reference-corpus.test.js` checks, without running .NET, that the recorded
 * fixtures still emit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { loadFixtures, loadPinned } from '../corpus-store.js';

export const COLUMNS = Object.freeze(['registry', 'references']);
export const baselinePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotnet-baseline.json');
const RUN_TIMEOUT_MS = 30_000;

/** The recorded baseline `{sdk, registry: [id], references: [id]}`; empty lists when the file does not exist. */
export function loadDotnetBaseline(path = baselinePath) {
  if (!existsSync(path)) return { sdk: null, registry: [], references: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The compilation options the corpus compiles a fixture with. */
export function fixtureOptions(fixture) {
  return {
    name: 'Fixture',
    ...(fixture.langVersion ? { langVersion: fixture.langVersion } : {}),
    ...(fixture.allowUnsafe ? { allowUnsafe: true } : {}),
  };
}

function runtimeConfig(version) {
  return JSON.stringify({
    runtimeOptions: {
      tfm: 'net' + version,
      framework: { name: 'Microsoft.NETCore.App', version: version + '.0' },
      configProperties: { 'System.Globalization.Invariant': true },
    },
  });
}

/** Runs an assembly; returns `{output, failure}` where `failure` is the first lines of stderr of a non-zero exit. */
function runOnDotnet(dotnet, path) {
  try {
    const output = execFileSync(dotnet, [path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: RUN_TIMEOUT_MS });
    return { output: output.replace(/\r\n/g, '\n'), failure: null };
  } catch (error) {
    const stderr = String(error.stderr ?? error.message).split('\n').slice(0, 2).join(' ');
    return { output: String(error.stdout ?? '').replace(/\r\n/g, '\n'), failure: stderr.slice(0, 300) || 'non-zero exit' };
  }
}

/** The `dotnet` host that runs the assemblies: the explicit path, `DOTNET`, `~/.dotnet/dotnet`, else `dotnet` on the PATH. */
export function dotnetHost(explicit = null) {
  const home = join(homedir(), '.dotnet', 'dotnet');
  return explicit ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet');
}

/** The SDK version a host reports, or null when there is no such host to start (a machine without .NET). */
export function sdkVersion(dotnet) {
  try {
    return execFileSync(dotnet, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    if (error.code === 'ENOENT' || error.status) return null;
    throw error;
  }
}

/**
 * A scratch directory to run fixtures in: `context(column)` is what `runFixtureOnDotnet` takes for the `registry` or
 * the `references` column, `close()` removes the directory.
 */
export function openDotnetScratch({ dotnet, sdk, pack }) {
  const scratch = join(tmpdir(), 'sharpforge-dotnet-axis-' + process.pid);
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, 'Fixture.runtimeconfig.json'), runtimeConfig(sdk.split('.').slice(0, 2).join('.')));
  return {
    context: column => ({ dotnet, assemblyPath: join(scratch, 'Fixture.dll'), options: column === 'references' ? { references: pack.references } : {} }),
    close: () => rmSync(scratch, { recursive: true, force: true }),
  };
}

/** One fixture on one column: `{ok, detail}`; `context` comes from `openDotnetScratch`. */
export function runFixtureOnDotnet(fixture, pin, context) {
  let result;
  try {
    result = compileToAssembly(fixture.source, { ...fixtureOptions(fixture), ...context.options });
  } catch (error) {
    return { ok: false, detail: 'compiler crash: ' + String(error.message).split('\n')[0] };
  }
  if (!result.assembly) {
    const errors = result.diagnostics.filter(entry => entry.severity === 'error');
    return { ok: false, detail: 'not emitted: ' + errors.map(entry => `${entry.code} ${entry.message}`).join('; ').slice(0, 240) };
  }
  writeFileSync(context.assemblyPath, result.assembly);
  const run = runOnDotnet(context.dotnet, context.assemblyPath),
    // A pinned unhandled exception or exit code ends the Roslyn build of the program with a non-zero exit as well.
    exitExpected = !!(pin.exception || pin.exitCode);
  if (run.output !== pin.output) return { ok: false, detail: run.failure ?? 'output differs' };
  if (run.failure && !exitExpected) return { ok: false, detail: run.failure };
  return { ok: true, detail: '' };
}

function main() {
  const args = process.argv.slice(2),
    option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null),
    dotnet = dotnetHost(option('--dotnet')),
    filter = option('--filter') ?? '',
    columns = option('--column') ? [option('--column')] : COLUMNS,
    update = args.includes('--update'),
    verbose = args.includes('--verbose'),
    pack = loadReferencePack();
  if (!pack) throw new Error('No .NET reference pack (packs/Microsoft.NETCore.App.Ref) was found; set DOTNET_ROOT');
  const sdk = sdkVersion(dotnet);
  if (!sdk) throw new Error(`No .NET host: '${dotnet}' could not be started; pass --dotnet <path>`);
  const scratch = openDotnetScratch({ dotnet, sdk, pack }),
    pinned = loadPinned(),
    fixtures = loadFixtures().filter(fixture => fixture.kind === 'output' && fixture.id.includes(filter)),
    baseline = loadDotnetBaseline(),
    next = { sdk, referencePack: pack.pack.version };
  let regressions = 0;
  try {
    for (const column of columns) {
      const context = scratch.context(column),
        recorded = new Set(baseline[column] ?? []),
        passing = [];
      // A `referencesOnly` fixture is written for the real class library: the registry column does not have it.
      const selected = column === 'registry' ? fixtures.filter(fixture => !fixture.referencesOnly) : fixtures;
      for (const fixture of selected) {
        const row = runFixtureOnDotnet(fixture, pinned.results.get(fixture.id), context);
        if (row.ok) passing.push(fixture.id);
        if (!row.ok && recorded.has(fixture.id)) {
          regressions++;
          console.log(`REGRESSION [${column}] ${fixture.id}: ${row.detail}`);
        } else if (verbose && !row.ok) console.log(`[${column}] ${fixture.id}: ${row.detail}`);
        else if (row.ok && !recorded.has(fixture.id) && !update) console.log(`new [${column}] ${fixture.id}`);
      }
      // A filtered run keeps the recorded entries it did not look at.
      const untouched = filter ? (baseline[column] ?? []).filter(id => !id.includes(filter)) : [];
      next[column] = [...untouched, ...passing].sort();
      console.log(`${column}: ${passing.length}/${selected.length} emitted assemblies print the pinned Roslyn output on .NET ${sdk}`);
    }
  } finally {
    scratch.close();
  }
  if (update) {
    for (const column of COLUMNS) next[column] ??= baseline[column] ?? [];
    writeFileSync(baselinePath, JSON.stringify(next, null, 1) + '\n');
    console.log('baseline updated: ' + baselinePath);
  } else if (regressions) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
