import { dirname } from 'node:path';
import { discoverSdkEnvironment } from './sdk-discovery.js';
import { findGlobalJson, resolveSdk } from './global-json.js';
import { parseWorkloadList, explainTargetAvailability } from './workloads.js';

/** Register SDK inspection without loading or evaluating workspace projects. */
export function registerNativeSdkServices(registry, { engine, workspace }) {
  let inventory = null;
  const discover = async () => inventory ??= await discoverSdkEnvironment({ executable: engine.executable, cwd: workspace.root });
  registry.register('sdk', 'inventory', async request => { if (request.refresh) inventory = null; return discover(); });
  registry.register('sdk', 'resolve', async request => {
    const directory = request.project ? dirname(await workspace.path(request.project)) : workspace.root;
    const global = await findGlobalJson(directory), installed = await discover();
    return { ...resolveSdk(global?.value, installed.sdks), globalJson: global?.path ?? null };
  });
  registry.register('sdk', 'workloads', async request => {
    const result = await engine.runTool({ arguments: ['workload', 'list'], trusted: request.trusted });
    if (result.exitCode !== 0) throw new Error('Workload listing failed: ' + result.stderr);
    const workloads = parseWorkloadList(result.stdout), installed = await discover();
    return { workloads, target: request.targetFramework ? explainTargetAvailability(request.targetFramework, {
      workloads, sdkVersion: installed.sdks.at(-1)?.version, platform: process.platform }) : null };
  });
  return { discover };
}
