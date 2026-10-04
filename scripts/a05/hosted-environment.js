import {openSync, readSync, closeSync} from 'node:fs';
import {join, normalize} from 'node:path';
import {availableParallelism, cpus, freemem, totalmem, loadavg, uptime, release} from 'node:os';
import {getHeapStatistics} from 'node:v8';
import {hostedResources} from './hosted-plan.js';

const githubNames = ['GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'GITHUB_WORKFLOW',
  'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'RUNNER_NAME', 'RUNNER_OS', 'RUNNER_ARCH',
  'RUNNER_ENVIRONMENT', 'ImageOS', 'ImageVersion'];

/** Bounded allowlisted observations only; never dump the environment or process command lines. */
export function boundedRead(path, maximum = 65536) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const buffer = Buffer.alloc(maximum + 1);
    const size = readSync(descriptor, buffer, 0, buffer.length, null);
    return {path, text: buffer.subarray(0, Math.min(size, maximum)).toString('utf8'), truncated: size > maximum};
  } catch (error) {
    return {path, unavailable: error.code ?? error.message};
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function cgroupPaths(membership) {
  const paths = new Set(['/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpuset.cpus.effective']);
  for (const line of membership.split('\n').slice(0, 32)) {
    const [, controllers, group] = line.split(':');
    if (!group?.startsWith('/') || group.includes('..')) continue;
    const suffixes = controllers === '' ? ['cpu.max', 'cpu.stat', 'cpuset.cpus.effective'] :
      controllers?.split(',').includes('cpu') ? ['cpu.cfs_quota_us', 'cpu.cfs_period_us', 'cpu.stat'] :
      controllers === 'cpuset' ? ['cpuset.cpus', 'cpuset.effective_cpus'] : [];
    const roots = controllers === '' ? ['/sys/fs/cgroup'] :
      controllers === 'cpuset' ? ['/sys/fs/cgroup/cpuset'] : ['/sys/fs/cgroup/cpu', '/sys/fs/cgroup/cpu,cpuacct'];
    for (const root of roots) for (const suffix of suffixes) paths.add(normalize(join(root, group, suffix)));
  }
  return [...paths].slice(0, 32);
}

export function hostedEnvironment(env = process.env) {
  const membership = boundedRead('/proc/self/cgroup');
  const status = boundedRead('/proc/self/status');
  const affinity = status.text?.split('\n').filter(line => /^(?:Cpus_allowed|Mems_allowed)/.test(line)).join('\n');
  const system = ['/proc/loadavg', '/proc/pressure/cpu', '/proc/pressure/memory',
    '/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'];
  const cpuStat = boundedRead('/proc/stat');
  if (cpuStat.text) cpuStat.text = cpuStat.text.split('\n').filter(line => /^cpu(?: |\d+ )/.test(line)).slice(0, 33).join('\n');
  return {observedAt: new Date().toISOString(), github: Object.fromEntries(githubNames.map(name => [name, env[name] ?? null])),
    node: process.version, versions: process.versions, executable: process.execPath, execArgv: process.execArgv,
    nodeOptions: env.NODE_OPTIONS ?? null, heapSizeLimit: getHeapStatistics().heap_size_limit,
    resourceControls: Object.fromEntries(Object.keys(hostedResources).map(name => [name, env[name] ?? null])),
    platform: process.platform, architecture: process.arch, os: release(),
    logicalCpus: cpus().length, availableParallelism: availableParallelism(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))],
    totalMemory: totalmem(), freeMemory: freemem(), loadAverage: loadavg(), uptimeSeconds: uptime(),
    affinity: {path: status.path, text: affinity ?? null, unavailable: status.unavailable ?? null},
    cgroupMembership: membership, cgroups: cgroupPaths(membership.text ?? '').map(path => boundedRead(path)),
    cpuStat, system: system.map(path => boundedRead(path)),
    scope: 'Before/after gauges, not continuous telemetry or proof of physical CPU exclusivity. Unavailable files stay explicit.'};
}
