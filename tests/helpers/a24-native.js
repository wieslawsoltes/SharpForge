import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NativeMSBuild, NativeWorkspace } from '@sharpforge/msbuild/node';
import { encodeWorkspaceFile } from '@sharpforge/archive';

const execute = promisify(execFile);
export const nativeEnabled = process.env.SHARPFORGE_TEMPLATE_NATIVE === '1';
export const dotnet = process.env.DOTNET_ROOT ? join(process.env.DOTNET_ROOT, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet') : 'dotnet';

export async function command(args, cwd, executable = dotnet, { timeoutMs = 60000, env = {} } = {}) {
  return execute(executable, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', ...env } });
}

export async function nativeTemporary(test, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  test.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function savePlan(directory, plan) {
  for (const record of plan.records) {
    const path = join(directory, record.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encodeWorkspaceFile(record));
  }
}

export async function diskRecords(directory, prefix = '') {
  const records = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) records.push(...await diskRecords(directory, path));
    else records.push({ path, bytes: new Uint8Array(await readFile(join(directory, path))) });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

export async function nativeBuild(directory, project, { action = 'build', restore = true, properties = {}, timeoutMs = 60000 } = {}) {
  const workspace = await NativeWorkspace.open(directory);
  const engine = new NativeMSBuild(workspace, { executable: dotnet, trusted: true, timeoutMs });
  try {
    const job = await engine.start({ project, action, restore, trusted: true,
      properties: { NuGetAudit: 'false', RestoreIgnoreFailedSources: 'true', ...properties }, maxNodes: 1 });
    const result = await engine.wait(job.id);
    assert.equal(result.status, 'succeeded', result.error ?? result.events.map(event => event.text).join(''));
    assert.equal(result.exitCode, 0);
    return result;
  } finally { await engine.close(); }
}
