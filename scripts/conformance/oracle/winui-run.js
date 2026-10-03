import { mkdtemp, cp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { root, oracleRoot, pin, platform, requireTarget, sha256 } from './toolchain.js';
import { runProcess } from './process.js';
import { assertDeterministic } from './roslyn-compile.js';

export async function winuiInput() {
  const directory = path.join(oracleRoot, 'WinUI');
  const names = (await readdir(directory)).filter(name => /\.(cs|csproj|manifest|json)$/.test(name)).sort();
  const files = await Promise.all(names.map(async name => ({ name, sha256: sha256(await readFile(path.join(directory, name))) })));
  return { id: 'winui-controls-dispatcher', inputHash: sha256(JSON.stringify(files)), files };
}

/** An unsupported non-Windows target is explicit; Windows must build and execute the real host. */
export async function runWinUI(toolchain, options = {}) {
  const support = requireTarget('winui');
  if (!support.supported) return support;
  const build = Number(os.release().split('.')[2]);
  if (build < pin.images.windows.minimumBuild) throw new Error(`WinUI needs Windows build >= ${pin.images.windows.minimumBuild}; resolved ${build}`);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-winui-'));
  try {
    await cp(path.join(oracleRoot, 'WinUI'), path.join(directory, 'WinUI'), { recursive: true, filter: source => !['obj', 'bin'].includes(path.basename(source)) });
    await cp(path.join(oracleRoot, 'global.json'), path.join(directory, 'global.json'));
    await cp(path.join(oracleRoot, 'NuGet.Config'), path.join(directory, 'NuGet.Config'));
    const project = path.join(directory, 'WinUI/Oracle.WinUI.csproj');
    const commands = [
      ['restore', project, '--locked-mode', '--configfile', path.join(directory, 'NuGet.Config')],
      ['build', project, '--no-restore', '-c', 'Release', '-o', path.join(directory, 'out')],
    ];
    for (const args of commands) {
      const result = await runProcess(toolchain.dotnet, args, { cwd: directory, timeoutMs: 600000, ...options });
      if (result.exitCode !== 0) throw new Error(`Native WinUI ${args[0]} failed: ${result.stdout}${result.stderr}`);
    }
    const measurements = [];
    const results = [];
    const executable = path.join(directory, 'out/Oracle.WinUI.exe');
    for (let i = 0; i < 2; i++) {
      const output = path.join(directory, `result-${i}.json`);
      const processResult = await runProcess(executable, [output], { cwd: path.dirname(executable), timeoutMs: 60000, ...options });
      if (processResult.exitCode !== 0 || processResult.signal) throw new Error(`Native WinUI execution requires a working interactive Windows desktop: ${JSON.stringify(processResult)}`);
      const observed = JSON.parse(await readFile(output, 'utf8'));
      results.push(observed.result);
      const samples = observed.measurements?.warmControlMs;
      if (!Array.isArray(samples) || samples.length !== 20 || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid native WinUI measurements');
      const ordered = [...samples].sort((a, b) => a - b);
      measurements.push({ ...observed.measurements, warmP95Ms: ordered[18], warmP99Ms: ordered[19], processMs: processResult.elapsedMs });
    }
    assertDeterministic(results[0], results[1], 'native WinUI control/dispatcher host');
    return { supported: true, target: platform, result: results[0], measurements, commands: commands.map(args => [toolchain.dotnet, ...args.map(arg => arg.replaceAll(directory, '<temporary>'))]).concat([[executable.replace(directory, '<temporary>'), '<temporary>/result.json']]) };
  } catch(error) {
    const retained=path.resolve(root,process.env.SHARPFORGE_RESULTS_DIR||'artifacts/results','oracles',platform,'winui-failure');
    await mkdir(retained,{recursive:true});
    await writeFile(path.join(retained,'error.json'),JSON.stringify({message:error.message,code:error.code,errno:error.errno,syscall:error.syscall,path:error.path,result:error.result},null,2)+'\n');
    try {await cp(path.join(directory,'out'),path.join(retained,'out'),{recursive:true});}catch(copyError){await writeFile(path.join(retained,'copy-error.txt'),copyError.message);}
    throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
