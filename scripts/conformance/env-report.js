import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import {npmCli} from './node-tools.js';
import {pathToFileURL} from 'node:url';
import {resultPath, repository} from './results.js';

export function probe(command, args, run = spawnSync) {
  const result = run(command, args, {encoding: 'utf8', timeout: 15000, cwd: repository});
  return {command: [command, ...args], available: !result.error && result.status === 0,
    status: result.status ?? null, stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '', error: result.error?.message ?? null};
}

export function environmentReport() {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const npm = npmCli();
  const playwright = probe(python, ['-c', `import importlib.metadata,json,pathlib,playwright; from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 print(json.dumps({'version':importlib.metadata.version('playwright'),'chromiumExecutable':p.chromium.executable_path,'installed':pathlib.Path(p.chromium.executable_path).exists(),'browsers':json.loads((pathlib.Path(playwright.__file__).parent/'driver/package/browsers.json').read_text())['browsers']}))`]);
  return {schemaVersion: 1, timestamp: new Date().toISOString(),
    commit: probe('git', ['rev-parse', 'HEAD']).stdout,
    runner: {os: os.platform(), release: os.release(), architecture: os.arch(),
      image: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
      runnerOS: process.env.RUNNER_OS ?? null, runnerArch: process.env.RUNNER_ARCH ?? null},
    github: {runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null, job: process.env.GITHUB_JOB ?? null},
    node: {version: process.version, executable: process.execPath, versions: process.versions},
    npm: npm ? probe(process.execPath, [npm, '--version']) : probe(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']),
    python: probe(python, ['--version']), playwright,
    chromiumOverride: process.env.CHROMIUM_EXECUTABLE ? probe(process.env.CHROMIUM_EXECUTABLE, ['--version']) : null,
    dotnet: probe(process.env.DOTNET_PATH || 'dotnet', ['--info']),
    dotnetSDKs: probe(process.env.DOTNET_PATH || 'dotnet', ['--list-sdks'])};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = await resultPath('env.json');
  await writeFile(path, JSON.stringify(environmentReport(), null, 2) + '\n');
  console.log(path);
}
