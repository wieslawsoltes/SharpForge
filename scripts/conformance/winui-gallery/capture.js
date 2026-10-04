import { cp, readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { oracleRoot, pin, requireTarget, resolveToolchain, sha256 } from '../oracle/toolchain.js';
import { runProcess } from '../oracle/process.js';
import { assertDeterministic } from '../oracle/roslyn-compile.js';
import { directory, loadGallery, validateDump, compareObservation } from './catalog.js';

/** Reuse the locked Windows oracle project; no package acquisition outside its existing restore lock. */
export async function captureGallery({ output, signal } = {}) {
  const target = requireTarget('winui');
  if (!target.supported) return { status: 'unsupported', ...target };
  if (Number(os.release().split('.')[2]) < pin.images.windows.minimumBuild) throw new Error('Windows build is below the oracle pin');
  if (!output) throw new Error('An output path is required');
  const catalog = await loadGallery();
  const toolchain = await resolveToolchain();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-gallery-'));
  try {
    await cp(path.join(oracleRoot, 'WinUI'), path.join(temporary, 'WinUI'), {
      recursive: true, filter: source => !['bin', 'obj'].includes(path.basename(source)),
    });
    for (const name of ['global.json', 'NuGet.Config']) await cp(path.join(oracleRoot, name), path.join(temporary, name));
    await cp(path.join(directory, 'native/Program.cs'), path.join(temporary, 'WinUI/Program.cs'));
    await cp(path.join(directory, 'fixtures'), path.join(temporary, 'WinUI/fixtures'), { recursive: true });
    const project = path.join(temporary, 'WinUI/Oracle.WinUI.csproj');
    const text = await readFile(project, 'utf8');
    await writeFile(project, text.replace('<PropertyGroup>', `<PropertyGroup>
    <StartupObject>Program</StartupObject>
    <EnableDefaultPageItems>false</EnableDefaultPageItems>
    <EnableDefaultApplicationDefinition>false</EnableDefaultApplicationDefinition>`));
    const commands = [
      ['restore', project, '--locked-mode', '--configfile', path.join(temporary, 'NuGet.Config')],
      ['build', project, '--no-restore', '-c', 'Release', '-o', path.join(temporary, 'out')],
    ];
    for (const args of commands) {
      const result = await runProcess(toolchain.dotnet, args, { cwd: temporary, signal, timeoutMs: 600000 });
      if (result.exitCode !== 0) throw new Error(`Gallery ${args[0]} failed: ${result.stdout}${result.stderr}`);
    }
    const observations = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      const file = path.join(temporary, `gallery-${repeat}.json`);
      const result = await runProcess(path.join(temporary, 'out/Oracle.WinUI.exe'), [directory, file], {
        cwd: path.join(temporary, 'out'), signal, timeoutMs: 60000,
      });
      if (result.exitCode !== 0 || result.signal) throw new Error(`Native Gallery failed: ${JSON.stringify(result)}`);
      observations.push(JSON.parse(await readFile(file, 'utf8')));
    }
    assertDeterministic(observations[0], observations[1], 'Gallery property dumps');
    const cases = observations[0].map(row => ({ ...row, inputHash: catalog.cases.find(item => item.id === row.id)?.inputHash }));
    const dump = validateDump({ schemaVersion: 1, oracle: 'winui-gallery', target: target.target,
      sdk: pin.sdk, runtime: pin.runtime, windowsAppSDK: pin.windowsAppSDK,
      environment: toolchain.environment, harnessSHA256: sha256(await readFile(path.join(directory, 'native/Program.cs'))), cases,
    }, catalog);
    for (const row of cases) {
      const fixture = catalog.cases.find(item => item.id === row.id);
      if (fixture.kind === 'negative' ? !row.xaml.rejected : row.xaml.rejected || row.csharp.rejected) {
        throw new Error(`Native fixture did not satisfy declared polarity: ${row.id}`);
      }
      if (fixture.source && !compareObservation(row.xaml, row.csharp)) throw new Error(`XAML/C# native mismatch: ${row.id}`);
      if (fixture.expected && !compareObservation(row.xaml, { rejected: false, properties: fixture.expected })) {
        throw new Error(`Native property expectation mismatch: ${row.id}`);
      }
    }
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(dump, null, 2)}\n`);
    return { status: 'captured', output, cases: cases.length };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await captureGallery({ output: process.argv[2] })));
}
