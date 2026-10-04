import {createPortableTestHarness} from './harness.js';

/** Lazily compile a test run, removing separately diagnosed non-runnable tests before creating an isolated VM session. */
export async function createManagedTestRuntime(discovery, options = {}) {
  const {backend = 'source', signal, compiler, SessionType} = options;
  if (!['source', 'cil'].includes(backend)) throw new Error('Portable tests support source and CIL execution');
  const compileApi = compiler ?? await import('@sharpforge/compiler');
  const Session = SessionType ?? (await import('@sharpforge/runtime')).ManagedInvocationSession;
  const unavailable = new Map();
  let candidates = discovery.tests.filter(test => !test.skipReason && !test.notRunnableReason && (!test.explicit || options.includeExplicit));
  let harness = null;
  let compiled = null;
  for (let pass = 0; pass < 8 && candidates.length; pass++) {
    signal?.throwIfAborted();
    try { harness = createPortableTestHarness(candidates, discovery.symbols); }
    catch (error) {
      for (const test of candidates) unavailable.set(test.id, [{code: 'SFT2401', severity: 'error', message: error.message}]);
      candidates = [];
      break;
    }
    const compileOptions = {langVersion: '14', ...options.compileOptions,
      name: 'SharpForge.PortableTests', outputKind: 'exe', mainTypeName: 'SharpForge.Testing.Entry'};
    compiled = backend === 'cil' ? compileApi.compileToIL(harness.sources, compileOptions) : compileApi.compile(harness.sources, compileOptions);
    if (compiled.success) break;
    const errors = compiled.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    const rejected = new Set();
    for (const test of candidates) {
      const failures = errors.filter(diagnostic => diagnostic.uri === test.source.path &&
        diagnostic.start >= test.method.declarationSpan.start && diagnostic.start <= test.method.declarationSpan.end);
      if (failures.length) { unavailable.set(test.id, failures); rejected.add(test.fqn); }
    }
    if (!rejected.size) {
      for (const test of candidates) unavailable.set(test.id, errors);
      candidates = [];
      break;
    }
    candidates = candidates.filter(test => !rejected.has(test.fqn));
  }
  if (candidates.length && !compiled?.success) {
    for (const test of candidates) unavailable.set(test.id, compiled?.diagnostics ?? [{code: 'SFT2402', severity: 'error',
      message: 'Portable test compilation did not converge within its bounded recovery passes'}]);
    candidates = [];
  }
  let session = null;
  if (candidates.length) {
    session = new Session(backend === 'cil' ? compiled.assembly : compiled.image,
      {backend, entryPoint: harness.entryPoint, maxInstructions: options.maxInstructions ?? 2_000_000,
        maxOutputCharacters: options.maxOutputCharacters ?? 1_000_000, virtualTime: false});
    await session.initialize({signal});
  }
  const invoke = async (method, invocationOptions) => {
    if (!session) throw new Error('There are no runnable compiled tests');
    return session.invoke('SharpForge.Testing.Entry.' + method, invocationOptions);
  };
  return {backend, unavailable, groups: harness?.groups ?? [], diagnostics: compiled?.diagnostics ?? [],
    initialize: invocationOptions => invoke('InitializeSuite', invocationOptions),
    initializeGroup: (group, invocationOptions) => invoke(group.initialize, invocationOptions),
    cleanupGroup: (group, invocationOptions) => invoke(group.cleanup, invocationOptions),
    cleanup: invocationOptions => invoke('CleanupSuite', invocationOptions),
    execute: (test, invocationOptions) => invoke(harness.invocation.get(test.id).method, invocationOptions),
    hasRunnableTests: candidates.length > 0, dispose: () => session?.dispose()};
}
