import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';

// These public overrides are applied by the canonical runner; it remains the only process launcher.
const nativeEnvironment = Object.freeze({
  DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_CLI_UI_LANGUAGE: 'en-US', VSLANG: '1033',
  COMPlus_DbgEnableMiniDump: '0', DOTNET_ROLL_FORWARD: 'Disable', DOTNET_ROLL_FORWARD_TO_PRERELEASE: '0',
});
const publicVariables = Object.freeze([
  'PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'DOTNET_ROOT', 'DOTNET', 'SHARPFORGE_ORACLE_DOTNET',
  'SHARPFORGE_ILASM', 'NODE_OPTIONS', 'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_TEST_CONCURRENCY',
  'SHARPFORGE_MAX_OLD_SPACE_MB', ...Object.keys(nativeEnvironment),
]);

/** Retain admitted commands and partial canonical results without replacing the native process runner. */
export function createProcessRecorder({ output, commands, save, processRunner = runProcess }) {
  return async (executable, args, options = {}) => {
    const id = String(commands.length + 1).padStart(2, '0');
    const effectiveEnvironment = { ...process.env, ...nativeEnvironment, ...options.env };
    const command = { id, executable, args, cwd: options.cwd ?? process.cwd(),
      environment: Object.fromEntries(publicVariables.map(name => [name, effectiveEnvironment[name] ?? null])),
      environmentScope: 'Public execution settings; unlisted inherited variables are not serialized.',
      timeoutMs: options.timeoutMs ?? 30000, maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024,
      startedAt: new Date().toISOString(), status: 'running', logs: {} };
    commands.push(command);
    await save();
    let result;
    try {
      result = await processRunner(executable, args, { ...options, cwd: command.cwd,
        timeoutMs: command.timeoutMs, maxOutputBytes: command.maxOutputBytes });
      command.status = 'exited';
      return result;
    } catch (error) {
      result = error.result;
      command.status = 'failed';
      command.error = { name: error.name, message: error.message };
      throw error;
    } finally {
      command.finishedAt = new Date().toISOString();
      if (result) {
        Object.assign(command, result);
        for (const stream of ['stdout', 'stderr']) {
          const bytes = Buffer.from(result[stream], 'utf8');
          const name = `process-${id}.${stream}.log`;
          await writeFile(join(output, name), bytes, { flag: 'wx' });
          command.logs[stream] = { path: name, bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex') };
        }
      }
      await save();
    }
  };
}
