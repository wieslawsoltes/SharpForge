import { join } from 'node:path';
import { normalizeBuildRequest, escapeMSBuild } from './contract.js';

const actionTargets = Object.freeze({
  build: 'Build', rebuild: 'Rebuild', clean: 'Clean', restore: 'Restore', pack: 'Pack', publish: 'Publish', test: 'VSTest'
});

export function createInvocation(request, { projectPath, jobDirectory, executable = 'dotnet', engine = 'dotnet' } = {}) {
  const normalized = normalizeBuildRequest(request), args = engine === 'dotnet' ? ['msbuild'] : [];
  args.push(projectPath ?? normalized.project, '-nologo', '-v:' + normalized.verbosity, '-m:' + normalized.maxNodes);
  for (const [name, value] of Object.entries(normalized.properties)) args.push('-p:' + name + '=' + escapeMSBuild(value));
  if (normalized.graphBuild) args.push('-graphBuild');
  if (normalized.restore && !['restore', 'evaluate', 'preprocess', 'targets', 'clean'].includes(normalized.action)) args.push('-restore');
  const target = actionTargets[normalized.action];
  if (target) args.push('-t:' + target);
  else if (normalized.action === 'target') args.push('-t:' + normalized.targets.join(';'));
  if (normalized.action === 'evaluate' || normalized.designTime) {
    const names = [...new Set([...normalized.propertyNames, 'MSBuildProjectFullPath', 'MSBuildVersion'])];
    args.push('-getProperty:' + names.join(','));
    if (normalized.itemNames.length) args.push('-getItem:' + normalized.itemNames.join(','));
  }
  if (normalized.resultTargets.length) args.push('-getTargetResult:' + normalized.resultTargets.join(';'));
  if (normalized.action === 'preprocess') args.push('-preprocess:' + join(jobDirectory, 'expanded.xml'));
  if (normalized.action === 'targets') args.push('-targets:' + join(jobDirectory, 'targets.txt'));
  if (normalized.binaryLog) args.push('-binaryLogger:' + join(jobDirectory, 'build.binlog') + ';ProjectImports=None');
  if (normalized.sarif) args.push('-p:ErrorLog=' + escapeMSBuild(join(jobDirectory, 'diagnostics.sarif') + ',version=2.1'));
  args.push('-p:UseSharedCompilation=' + normalized.compilerServer, ...normalized.arguments, '-nodeReuse:' + normalized.nodeReuse);
  return { executable, args, request: normalized };
}
