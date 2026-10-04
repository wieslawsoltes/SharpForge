import { runNativeProcess } from './process.js';

export function parseSdkList(text) {
  const sdks = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s+\[([^\]]+)\]\s*$/.exec(line);
    if (!match) throw new Error('Unrecognised dotnet SDK listing line: ' + line);
    sdks.push({ version: match[1], path: match[2].replace(/[\\/]$/, '') + '/' + match[1],
      basePath: match[2], preview: match[1].includes('-') });
  }
  return sdks;
}

export function parseRuntimeList(text) {
  const runtimes = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\s*(\S+)\s+(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s+\[([^\]]+)\]\s*$/.exec(line);
    if (!match) throw new Error('Unrecognised dotnet runtime listing line: ' + line);
    runtimes.push({ name: match[1], version: match[2], path: match[3], preview: match[2].includes('-') });
  }
  return runtimes;
}

export function parseDotnetInfo(text) {
  const result = { raw: String(text) };
  const mapping = { 'OS Name': 'os', 'OS Version': 'osVersion', 'OS Platform': 'platform', 'RID': 'rid',
    'Base Path': 'basePath', 'Architecture': 'architecture', 'MSBuild version': 'msbuildVersion' };
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line);
    if (match && mapping[match[1]]) result[mapping[match[1]]] = match[2];
  }
  return result;
}

/** Tool discovery never evaluates workspace projects. Unavailable SDKs are explicit capabilities. */
export async function discoverSdkEnvironment({ executable = 'dotnet', cwd, spawnProcess, signal } = {}) {
  const run = args => runNativeProcess({ executable, arguments: args, cwd, timeoutMs: 15000, maxOutputBytes: 1048576 },
    { spawnProcess, signal });
  try {
    const [sdkResult, runtimeResult, infoResult] = await Promise.all([run(['--list-sdks']), run(['--list-runtimes']), run(['--info'])]);
    if ([sdkResult, runtimeResult, infoResult].some(result => result.exitCode !== 0)) {
      return { available: false, sdks: [], runtimes: [], error: 'dotnet discovery failed: ' + sdkResult.stderr + runtimeResult.stderr + infoResult.stderr };
    }
    return { available: true, executable, sdks: parseSdkList(sdkResult.stdout), runtimes: parseRuntimeList(runtimeResult.stdout),
      info: parseDotnetInfo(infoResult.stdout), platform: process.platform, architecture: process.arch };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { available: false, sdks: [], runtimes: [], error: 'Install a .NET SDK or configure its executable: ' + error.message };
  }
}
