import { parseXml } from '@sharpforge/project-system';
import { runNativeProcess } from './process.js';
import { parseWorkloadList, explainTargetAvailability } from './workloads.js';

const workloadTarget = /^net\d+\.\d+-(?:android|ios|maccatalyst|tvos|tizen)[\d.]*$/i;

function literalFrameworks(request, source) {
  const explicit = Object.entries(request.properties).find(([name]) => name.toLowerCase() === 'targetframework')?.[1];
  if (explicit) return [explicit];
  const project = parseXml(source, { maxLength: 4 * 1024 * 1024 });
  let value = '';
  for (const group of project.children) {
    if (group.name !== 'PropertyGroup' || group.attributes.Condition) continue;
    for (const property of group.children) {
      if (['TargetFramework', 'TargetFrameworks'].includes(property.name) && !property.attributes.Condition) value = property.text;
    }
  }
  return /\$\(|@\(|%\(/.test(value) ? [] : value.split(';').map(framework => framework.trim()).filter(Boolean);
}

/** Detect explicit missing platform workloads before the build process starts; complex imported TFMs remain SDK-evaluated. */
export function createWorkloadPreflight(workspace, { executable, spawnProcess } = {}) {
  return async request => {
    if (!['build', 'rebuild', 'publish', 'pack', 'test', 'target'].includes(request.action) || !/\.[a-z]*proj$/i.test(request.project)) return;
    const frameworks = literalFrameworks(request, (await workspace.read(request.project)).text).filter(framework => workloadTarget.test(framework));
    if (!frameworks.length) return;
    const result = await runNativeProcess({ executable, arguments: ['workload', 'list'], cwd: workspace.root,
      timeoutMs: 15000, maxOutputBytes: 1048576 }, { spawnProcess });
    if (result.exitCode !== 0) throw Object.assign(new Error('Unable to inspect installed workloads: ' + result.stderr),
      { code: 'SFMSB_WORKLOAD_INVENTORY', status: 400 });
    const workloads = parseWorkloadList(result.stdout);
    for (const framework of frameworks) {
      const diagnostic = explainTargetAvailability(framework, { workloads, platform: process.platform });
      if (diagnostic.available === false) throw Object.assign(new Error(diagnostic.message + '. Run: ' + diagnostic.installCommand),
        { code: diagnostic.code, status: 400, diagnostic });
    }
  };
}
