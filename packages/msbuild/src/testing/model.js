export const TEST_MODEL_VERSION = 1;
export const TestOutcome = Object.freeze({Passed: 'passed', Failed: 'failed', Skipped: 'skipped', NotRun: 'not-run',
  NotRunnable: 'not-runnable', Cancelled: 'cancelled', TimedOut: 'timed-out'});
const outcomes = new Set(Object.values(TestOutcome));

function bounded(value, label, max = 4096) {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new Error('Invalid test ' + label);
  }
  return value;
}

function stableHash(value) {
  const parts = [];
  for (let seed = 0; seed < 4; seed++) {
    let hash = (2166136261 + seed * 2654435761) >>> 0;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
    parts.push(hash.toString(16).padStart(8, '0'));
  }
  return parts.join('');
}

/** Provider-neutral identity: workspace project, fully qualified method and native-compatible data-row display identity. */
export function testCaseId(input) {
  const project = bounded(input.project, 'project').replaceAll('\\', '/');
  const fqn = bounded(input.fqn, 'fully qualified name');
  const row = input.rowKey ?? input.displayName ?? fqn;
  return 'test-v1-' + stableHash(JSON.stringify([project, fqn, bounded(row, 'row identity', 16_384)]));
}

/** Validate the shared immutable discovery record. Unknown framework APIs use notRunnableReason, never an assumed pass. */
export function createTestCase(input) {
  if (!input || typeof input !== 'object') throw new Error('Expected TestCase input');
  const fqn = bounded(input.fqn, 'fully qualified name');
  const displayName = bounded(input.displayName ?? fqn, 'display name', 16_384);
  const project = bounded(input.project, 'project').replaceAll('\\', '/');
  const traits = Object.create(null);
  for (const [key, values] of Object.entries(input.traits ?? {})) {
    bounded(key, 'trait name', 256);
    const entries = Array.isArray(values) ? values : [values];
    if (entries.length > 256) throw new Error('Test trait count limit exceeded');
    traits[key] = Object.freeze([...new Set(entries.map(value => bounded(String(value), 'trait value', 1024)))]);
  }
  if (Object.keys(traits).length > 256 || (input.dataRows?.length ?? 0) > 10_000) throw new Error('Test metadata limit exceeded');
  const source = input.source ? {...input.source} : null;
  if (source && (!source.path || !Number.isInteger(source.line) || source.line < 1)) throw new Error('Invalid test source span');
  return Object.freeze({...input, schemaVersion: TEST_MODEL_VERSION, project, fqn, displayName,
    id: testCaseId({...input, project, fqn, displayName}), traits: Object.freeze(traits), source: source && Object.freeze(source),
    dataRows: Object.freeze([...(input.dataRows ?? [])]), skipReason: input.skipReason ?? null,
    notRunnableReason: input.notRunnableReason ?? null});
}

/** Durations are finite nonnegative milliseconds; outcome is explicit and never inferred from console text. */
export function createTestResult(test, input) {
  if (!outcomes.has(input.outcome)) throw new Error('Unknown test outcome');
  const durationMs = input.durationMs ?? 0;
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('Invalid test duration');
  return Object.freeze({schemaVersion: TEST_MODEL_VERSION, testId: test.id, fqn: test.fqn, displayName: test.displayName,
    outcome: input.outcome, durationMs, message: input.message ?? '', stackTrace: input.stackTrace ?? '',
    stdout: input.stdout ?? '', stderr: input.stderr ?? '', source: input.source ?? test.source,
    attachments: Object.freeze([...(input.attachments ?? [])]), diagnostics: Object.freeze([...(input.diagnostics ?? [])]),
    backend: input.backend ?? 'unknown', nativeId: input.nativeId ?? null});
}

/** Build a deterministic project/class/method/data-row explorer tree in O(n log n) for stable display ordering. */
export function createTestTree(tests) {
  if (!Array.isArray(tests) || tests.length > 100_000) throw new Error('Test tree size limit exceeded');
  const projects = new Map();
  const ids = new Set();
  for (const test of tests) {
    if (ids.has(test.id)) throw new Error('Duplicate TestCase identity');
    ids.add(test.id);
    let project = projects.get(test.project);
    if (!project) projects.set(test.project, project = {id: 'project:' + test.project, kind: 'project', label: test.project, classes: new Map()});
    const index = test.fqn.lastIndexOf('.');
    const className = index < 0 ? '<global>' : test.fqn.slice(0, index);
    let type = project.classes.get(className);
    if (!type) project.classes.set(className, type = {id: project.id + ':' + className, kind: 'class', label: className, children: []});
    type.children.push({id: test.id, kind: 'test', label: test.displayName, test});
  }
  return [...projects.values()].sort((left, right) => left.label.localeCompare(right.label)).map(project => ({
    id: project.id, kind: project.kind, label: project.label, children: [...project.classes.values()]
      .sort((left, right) => left.label.localeCompare(right.label)).map(type => ({...type,
        children: type.children.sort((left, right) => left.label.localeCompare(right.label))}))
  }));
}

/** Validate an adapter contribution; native and portable providers implement the same async discovery/run contract. */
export function defineTestAdapter(adapter) {
  bounded(adapter?.id, 'adapter id', 256);
  for (const method of ['discover', 'run', 'cancel', 'close']) {
    if (typeof adapter[method] !== 'function') throw new Error('Test adapter requires ' + method);
  }
  return adapter;
}
