import { requestProjectCompilation, projectLaunchOptions } from '../project-build.js';
import { projectRuntimeDependencies } from '../project-runtime-input.js';
import { abortError, workbenchError } from './state-events.js';

const forwardedState = [
  'projectSystem', 'projectSnapshot', 'revision', 'disk', 'workspaceEpoch', 'nativeMode', 'files', 'configuration',
  'name', 'langVersion', 'extensionConfig', 'launchProfile', 'nativeProjectContext', 'nativeContextFiles',
  'nativeCompilationOptions', 'nativeAdditionalFiles'
];

/** Background compilation pins its project while observing the live workspace's cancellation and identity fences. */
export function studioProjectState(getState, projectId) {
  const selected = projectId === '$workspace' ? null : projectId;
  const state = {};
  for (const key of forwardedState) Object.defineProperty(state, key, {
    enumerable: true,
    get: () => getState()[key],
    set: value => { getState()[key] = value; }
  });
  Object.defineProperty(state, 'startupProject', { enumerable: true, get: () => selected });
  return state;
}

/** One workspace owns mutable portable target outputs; project workers and their request generations remain independent. */
export class StudioProjectCompiler {
  constructor(getState, { compile = requestProjectCompilation } = {}) {
    this.getState = getState;
    this.compile = compile;
    this.tail = Promise.resolve();
  }

  request({ projectId, method, params = {}, options = {}, request }) {
    const state = studioProjectState(this.getState, projectId);
    const captured = { system: state.projectSystem, disk: state.disk, epoch: state.workspaceEpoch, revision: state.revision };
    const run = () => {
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      if (state.projectSystem !== captured.system || state.disk !== captured.disk ||
          state.workspaceEpoch !== captured.epoch || state.revision !== captured.revision) {
        throw workbenchError('BUILD_STALE', 'Workspace changed before project compilation began');
      }
      return this.compile(state, { request: (name, input) => request(name, input, options) }, method,
        { ...params, signal: options.signal });
    };
    if (method !== 'build' || !state.projectSystem || state.nativeMode) return run();
    const pending = this.tail.then(run);
    // The caller still receives rejection; the scheduling tail only releases the next complete graph operation.
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  launchOptions(projectId, profile, built, explicitProfile) {
    const state = this.getState();
    const project = studioProjectState(this.getState, projectId);
    const launch = projectLaunchOptions(project);
    return {
      ...state.debugSettings,
      functionBreakpoints: state.functionBreakpoints,
      dependencies: projectRuntimeDependencies(built),
      programArguments: [...(explicitProfile ? profile.arguments : launch.args ?? profile.arguments ?? [])],
      environment: { ...launch.environment, ...profile.environment },
      ...(launch.workingDirectory !== undefined ? { workingDirectory: launch.workingDirectory } : {})
    };
  }
}
