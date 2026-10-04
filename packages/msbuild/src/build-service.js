import { FastUpToDateCheck } from './up-to-date.js';
import { projectContextId } from './project-context.js';
import { resolveSolutionBuildRequest } from './solution-selection.js';

/** Incremental execution is opt-in for declared complete input/output sets; native MSBuild handles all other targets. */
export class NativeBuildService {
  constructor(engine, { upToDate = new FastUpToDateCheck() } = {}) { this.engine = engine; this.upToDate = upToDate; }
  async build(request, { signal } = {}) {
    await this.engine.authorize(request);
    request = await resolveSolutionBuildRequest(this.engine.workspace, request, { signal });
    const key = projectContextId({ ...request, targetFramework: request.framework, runtimeIdentifier: request.runtime });
    const paths = { inputs: request.inputs ?? [], outputs: request.outputs ?? [], properties: request.properties ?? {} };
    for (const path of [...paths.inputs, ...paths.outputs]) {
      if (!this.engine.workspace.relative(path)) throw new Error('Fast-check paths must be canonical files inside the workspace');
    }
    if (request.fastUpToDate) {
      const check = await this.upToDate.check(key, paths);
      if (check.upToDate) return { status: 'succeeded', skipped: true, reason: check.reason, contextId: key, diagnostics: [] };
    }
    signal?.throwIfAborted();
    const started = await this.engine.start(request), abort = () => this.engine.cancel(started.id);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let result;
    try { result = await this.engine.wait(started.id); }
    finally { signal?.removeEventListener('abort', abort); }
    if (result.status === 'succeeded' && request.fastUpToDate && paths.outputs.length) await this.upToDate.record(key, paths);
    return { ...result, contextId: key, skipped: false };
  }
}
