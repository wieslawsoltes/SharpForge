/** Validate retained product observations; these checks never execute or simulate an application. */
export const sessionIOPhases = Object.freeze([
  'three-live-workers',
  'denied-origin',
  'explicit-session-grants',
  'concurrent-http-numerics',
  'selected-http-cancellation',
  'selected-grant-revocation',
  'revoked-session-restart',
]);

export const sessionIOLimits = Object.freeze([
  'Host-wide numerical admission and scheduler fairness remain unqualified.',
  'Managed WebSocket integration is absent; the separate JavaScript transport is outside this fixture.',
  'No provider authentication, application HTML export, native runtime or physical GPU qualification is implied.',
]);

const tags = ['alpha', 'beta', 'alpha-copy'];
const require = (condition, message) => {
  if (!condition) throw new Error('Invalid session I/O evidence: ' + message);
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function requireCompletedBuild(build, commit) {
  require(build?.format === 'sharpforge-build-identity' && build.version === 1 && build.stable === true,
    'a stable production build is required');
  require(build.source?.commit === commit && build.source.clean === true, 'production build is from another or dirty revision');
}

/** A successful component remains blocked for the wider R015 numeric/network obligation. */
export function validateSessionIO(observation, { commit, assets, sourceSha256 }) {
  require(/^[a-f0-9]{40}$/.test(commit), 'an exact committed revision is required');
  require(observation?.schemaVersion === 1 && observation.kind === 'release15-session-io', 'unknown observation format');
  require(observation.componentStatus === 'passed' && !observation.failure && !observation.activePhase, 'component did not finish');
  require(observation.source?.commit === commit, 'observations name a different source revision');
  require(['chromium', 'firefox', 'webkit'].includes(observation.browser?.name)
    && typeof observation.browser.version === 'string' && observation.browser.version.length > 0, 'actual browser identity is missing');
  require(same(observation.checks?.map(row => row.name), sessionIOPhases)
    && observation.checks.every(row => row.status === 'passed'), 'required phases are incomplete, reordered or duplicated');
  require(same(observation.unexecutedPhases, []) && observation.cleanup?.status === 'passed'
    && observation.cleanup.liveApplications === 0 && observation.cleanup.endpointStopped === true, 'cleanup or execution is incomplete');
  for (const row of observation.checks) {
    require(row.screenshot === `session-io-${row.name}.png`, 'phase screenshot identity differs');
  }
  const [workers, denied, grants, concurrent, cancelled, revoked, restarted] = observation.checks;
  require(workers.productionRuntimeWorkers === true && workers.productionCompilerWorkers === true
    && workers.distinctWorkerRoles === true && workers.runtimeWorkers === 3 && workers.compilerWorkers === 2,
  'production worker topology differs');
  require(workers.sessions?.length === 3 && new Set(workers.sessions.map(row => row.id)).size === 3
    && new Set(workers.sessions.map(row => row.identity)).size === 3, 'application identities are missing or duplicated');
  require(same([...workers.sessions.map(row => row.tag)].sort(), [...tags].sort()), 'application arguments crossed identities');
  const ids = new Map(workers.sessions.map(row => [row.tag, row.id]));
  for (const row of workers.sessions) {
    require(row.project === (row.tag === 'beta' ? 'Beta/Beta.csproj' : 'Alpha/Alpha.csproj'), 'project ownership differs');
    const url = new URL(row.workerUrl);
    require(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password,
      'runtime worker is not served by the owned production host');
    require(typeof row.engine === 'string' && row.engine.length > 0, 'actual execution engine is missing');
  }
  require(workers.source === 'session-io-source.json' && workers.sourceSha256 === sourceSha256,
    'generated source bytes differ');
  const expectedAssets = new Map(assets.map(row => [row.path, row.sha256]));
  for (const path of ['studio.js', 'compiler.worker.js', 'runtime.worker.js']) {
    require(expectedAssets.has(path) && workers.servedAssets?.[path] === expectedAssets.get(path), 'served production bytes differ: ' + path);
  }
  require(denied.sessionId === ids.get('alpha') && denied.endpointRequests === 0
    && denied.runtime?.network?.requests === 0 && denied.runtime.compute?.completed === 1
    && denied.runtime.pendingExternal === 0, 'ungranted HTTP was not rejected independently of numerical work');
  const origin = new URL(grants.endpoint);
  require(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.origin === grants.endpoint,
    'the granted endpoint is not an exact loopback origin');
  require(grants.sessions?.length === 3 && grants.sessions.every(row =>
    same(row.activeGrants?.network?.allowedOrigins, [grants.endpoint])), 'per-session active grants are missing');
  require(same(Object.keys(concurrent.runtimes ?? {}).sort(), [...ids.values()].sort()), 'concurrent runtime observations are incomplete');
  for (const runtime of Object.values(concurrent.runtimes)) {
    require(runtime.compute?.completed === 1 && runtime.compute.slots?.length === 1
      && ['scalar', 'wasm-simd128'].includes(runtime.compute.slots[0]?.backend)
      && runtime.network?.requests === 1 && runtime.network.active === 1 && runtime.pendingExternal === 1,
    'real numerical completion and overlapping active HTTP windows were not observed');
  }
  require(cancelled.sessionId === ids.get('alpha') && cancelled.runtime?.network?.canceled === 1
    && cancelled.runtime.network.active === 0 && cancelled.runtime.pendingExternal === 0, 'selected HTTP cancellation is incomplete');
  require(revoked.revokedSession === ids.get('beta') && revoked.activeDebugger === ids.get('alpha-copy')
    && revoked.revokedRuntime?.pendingExternal === 0 && revoked.revokedRuntime.network?.active === 0
    && revoked.survivingRuntime?.network?.completed === 1 && revoked.survivingRuntime.pendingExternal === 0,
  'targeted revocation interrupted the wrong application or retained an external operation');
  require(restarted.deniedRuntime?.network?.requests === 0 && restarted.deniedRuntime.compute?.completed === 1
    && restarted.deniedRuntime.pendingExternal === 0, 'restart restored revoked access or lost numerical work');
  validateEndpoint(observation.endpointEvents);
  return { status: 'blocked', componentStatus: 'passed', requirement: 'numeric-network',
    blockers: [{ id: 'FAIR-SESSION-IO', taskIds: ['SF-R015-T02', 'SF-A12-T10'], reason: sessionIOLimits.slice(0, 2).join(' ') }],
    limits: [...sessionIOLimits] };
}

function validateEndpoint(events) {
  require(Array.isArray(events) && events.length === 6, 'endpoint event count differs');
  for (const tag of tags) {
    const rows = events.filter(row => row.tag === tag);
    require(rows.length === 2 && rows[0].event === 'received' && ['responded', 'disconnected'].includes(rows[1].event),
      'endpoint did not observe one real request and terminal response per application');
    require(rows[0].cookiePresent === false && rows[0].authorizationPresent === false, 'request carried ambient credentials');
    require(rows.every(row => Number.isFinite(row.milliseconds) && row.milliseconds >= 0)
      && rows[1].milliseconds >= rows[0].milliseconds, 'endpoint event timing is malformed');
  }
  const arrivals = events.filter(row => row.event === 'received');
  const terminals = events.filter(row => row.event !== 'received');
  require(Math.max(...arrivals.map(row => row.milliseconds)) <= Math.min(...terminals.map(row => row.milliseconds)),
    'the real HTTP request windows did not overlap');
}
