import { runNativeProcess } from './process.js';

/** Close SDK-owned reusable MSBuild and compiler servers after the host's queue has drained. */
export async function shutdownBuildServers({ executable, cwd, spawnProcess }) {
  const result = await runNativeProcess({ executable, arguments: ['build-server', 'shutdown'],
    cwd, timeoutMs: 30000, maxOutputBytes: 65536 }, { spawnProcess });
  if (result.exitCode !== 0 || result.reason) {
    throw Object.assign(new Error('Build server shutdown failed: ' + (result.stderr || result.reason || result.exitCode)),
      { code: 'SFMSB_SERVER_SHUTDOWN' });
  }
  return result;
}
