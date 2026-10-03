import {readDesignSource, analyzeDesignSources} from './source-analysis.js';
import {planDesignSourceUpdate, assertSourceBaseline} from './source-plan.js';
import {checkSourceCancellation, failSource} from './source-errors.js';

/** Optimistic immutable analysis baseline. Editor history and final atomic source writes belong to the host. */
export class CSharpDesignSession {
  constructor(text, options = {}) {
    this.options = options;
    this.analysis = readDesignSource(text, options);
    this.version = 0;
    this.generation = options.generation ?? 0;
    this.disposed = false;
    this.plans = new WeakSet();
  }

  ensureActive() {
    if (this.disposed) failSource('Design source session is disposed', null, 'SFSYNC_CANCELLED');
    checkSourceCancellation(this.options.signal);
  }

  read(text, options = {}) {
    this.ensureActive();
    const analysis = readDesignSource(text, {...this.options, sources: this.analysis.sources, ...options,
      methodName: this.analysis.method.name, previous: this.analysis});
    this.analysis = analysis;
    this.version++;
    return this.document;
  }

  readSources(sources, options = {}) {
    this.ensureActive();
    const analysis = analyzeDesignSources(sources, {...this.options, ...options, uri: this.analysis.uri,
      methodName: this.analysis.method.name, previous: this.analysis});
    this.analysis = analysis;
    this.version++;
    return this.document;
  }

  plan(document, current = this.analysis.text, options = {}) {
    this.ensureActive();
    const plan = {...planDesignSourceUpdate(this.analysis, document, current, options),
      expectedVersion: this.version, expectedGeneration: this.generation};
    this.plans.add(plan);
    return plan;
  }

  commit(plan, {currentSources = plan.expectedSources, requireCompilation = false} = {}) {
    this.ensureActive();
    if (!this.plans.has(plan) || plan.expectedVersion !== this.version || plan.expectedGeneration !== this.generation) {
      failSource('A newer synchronization has replaced this update', null, 'SFSYNC_CONFLICT');
    }
    assertSourceBaseline(this.analysis, currentSources);
    if (requireCompilation && !plan.compilationSucceeded) failSource('Candidate C# did not compile', null, 'SFSYNC_COMPILE');
    this.plans.delete(plan);
    this.analysis = plan.analysis;
    this.version++;
    return this.document;
  }

  invalidate() {
    this.ensureActive();
    this.generation++;
    this.version++;
    this.plans = new WeakSet();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.plans = new WeakSet();
  }

  get document() { return structuredClone(this.analysis.document); }
}
