import { createInvocation } from '../src/invocation.js';
import { NativeMSBuild } from '../src/engine.js';
import { verifyBuildOutputs, verifyExpectedFailure } from './verify-outputs.js';
import { qualifyProcessTreeCancellation } from './process-tree.js';
import { qualifyLongPaths } from './long-paths.js';

export function windowsQualificationCells(platform = process.platform) {
  return ['standalone-msbuild', 'cancel-grandchildren', 'long-paths', 'backslash-diagnostics'].map(capability => ({
    capability, status: platform === 'win32' ? 'pending' : 'skipped',
    reason: platform === 'win32' ? 'Requires an installed MSBuild.exe and native execution evidence' : 'Windows runner unavailable'
  }));
}
export function createWindowsInvocation(projectPath, options = {}) {
  return createInvocation({ project: 'App/App.csproj', trusted: true, ...options }, { projectPath, engine: 'msbuild', executable: 'MSBuild.exe' });
}

/** Run the standalone Windows toolset; unavailable installations remain skips rather than simulator passes. */
export async function qualifyWindowsMSBuild(workspace, { executable = 'MSBuild.exe', framework } = {}) {
  if (process.platform !== 'win32') return { status: 'skipped', reason: 'Windows runner unavailable', engine: 'msbuild' };
  const engine = new NativeMSBuild(workspace, { engine: 'msbuild', executable, trusted: true });
  const capability = await engine.probe();
  if (!capability.available) return { status: 'skipped', reason: capability.error, engine: 'msbuild' };
  const actions = [], boundaryChecks = [];
  try {
    for (const action of ['restore', 'build', 'pack', 'publish']) {
      const job = await engine.start({ action, project: 'App/App.csproj', trusted: true, restore: action !== 'restore' });
      const result = await engine.wait(job.id);
      let error = result.error;
      try {
        if (result.status !== 'succeeded') throw new Error('Native action failed');
        await verifyBuildOutputs(workspace.root, action, framework);
      } catch (failure) { error = failure.message; }
      const negative = await engine.wait((await engine.start({ action, project: 'Failure/Failure.csproj', trusted: true })).id);
      try { verifyExpectedFailure(negative); }
      catch (failure) { error = [error, failure.message].filter(Boolean).join('; '); }
      actions.push({ action, status: error ? 'failed' : 'passed', invocation: result.invocation,
        diagnostics: result.diagnostics, failureDiagnostics: negative.diagnostics, artifacts: result.artifacts, error });
    }
    for (const qualify of [qualifyProcessTreeCancellation, qualifyLongPaths]) {
      try { boundaryChecks.push(await qualify(engine)); }
      catch (error) { boundaryChecks.push({ capability: qualify.name, status: 'failed', error: error.message }); }
    }
  } finally { await engine.close(); }
  return { status: [...actions, ...boundaryChecks].every(action => action.status === 'passed') ? 'passed' : 'failed',
    engine: 'msbuild', capability, actions, boundaryChecks };
}
