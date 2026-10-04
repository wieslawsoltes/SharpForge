import {parseXml} from '@sharpforge/project-system';
import {createTestCase, createTestResult, TestOutcome} from './model.js';

const local = node => node.name.split(':').at(-1);
const child = (node, name) => node?.children.find(value => local(value) === name);
function descendants(root, name) {
  const result = [];
  const visit = node => { if (local(node) === name) result.push(node); for (const value of node.children) visit(value); };
  visit(root);
  return result;
}

/** Parse TimeSpan duration to milliseconds without applying locale or wall-clock assumptions. */
export function parseTestDuration(value = '00:00:00') {
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/.exec(value);
  if (!match || Number(match[3]) > 59 || Number(match[4]) > 59 || Number(match[2]) > 23) throw new Error('Invalid TRX duration');
  return ((Number(match[1] ?? 0) * 24 + Number(match[2])) * 3600 + Number(match[3]) * 60 + Number(match[4])) * 1000 +
    Number('0.' + (match[5] ?? '0')) * 1000;
}

const outcomeMap = Object.freeze({Passed: TestOutcome.Passed, Failed: TestOutcome.Failed, Error: TestOutcome.Failed,
  Timeout: TestOutcome.TimedOut, Aborted: TestOutcome.Cancelled, NotExecuted: TestOutcome.Skipped, Inconclusive: TestOutcome.NotRunnable,
  Pending: TestOutcome.NotRun, NotRunnable: TestOutcome.NotRunnable, Disconnected: TestOutcome.NotRun});

function attachmentPath(value) {
  if (!value || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid TRX attachment');
  return value.replaceAll('\\', '/');
}

/** Parse native results, definition identities, failure output and attachments; no result is fabricated for a log line. */
export function parseTrx(source, options = {}) {
  const {project, sourceTests = [], backend = 'native-vstest', signal, maxTests = 100_000} = options;
  signal?.throwIfAborted();
  const root = parseXml(source, {maxLength: 32_000_000, maxNodes: 1_000_000, maxDepth: 128});
  if (local(root) !== 'TestRun') throw new Error('Expected TRX TestRun root');
  const definitions = new Map(descendants(root, 'UnitTest').map(node => [node.attributes.id, node]));
  const byDisplay = new Map(sourceTests.map(test => [test.displayName, test]));
  const byFqn = new Map(sourceTests.map(test => [test.fqn, test]));
  const results = [];
  const tests = [];
  for (const node of descendants(root, 'UnitTestResult')) {
    signal?.throwIfAborted();
    if (results.length >= maxTests) throw new Error('TRX result limit exceeded');
    const definition = definitions.get(node.attributes.testId);
    const method = child(definition, 'TestMethod');
    const className = method?.attributes.className?.split(',')[0];
    const fqn = className && method.attributes.name ? className + '.' + method.attributes.name : node.attributes.testName;
    const displayName = node.attributes.testName ?? definition?.attributes.name ?? fqn;
    const known = byDisplay.get(displayName) ?? byFqn.get(fqn);
    const test = known ?? createTestCase({project, fqn, displayName, framework: 'native', nativeId: node.attributes.testId});
    const output = child(node, 'Output');
    const error = child(output, 'ErrorInfo');
    const attachments = descendants(node, 'ResultFile').map(file => ({path: attachmentPath(file.attributes.path), kind: 'test-attachment'}));
    for (const entry of descendants(node, 'UriAttachment')) {
      const uri = child(entry, 'A');
      if (uri?.attributes.href) attachments.push({path: attachmentPath(uri.attributes.href), description: uri.text, kind: 'test-attachment'});
    }
    const nativeOutcome = node.attributes.outcome;
    const outcome = outcomeMap[nativeOutcome] ?? TestOutcome.NotRunnable;
    const diagnostics = Object.hasOwn(outcomeMap, nativeOutcome) ? [] : [{code: 'SFT2301', severity: 'error',
      message: 'Unknown native TRX outcome: ' + nativeOutcome}];
    tests.push(test);
    results.push(createTestResult(test, {outcome, durationMs: parseTestDuration(node.attributes.duration),
      message: child(error, 'Message')?.text ?? '', stackTrace: child(error, 'StackTrace')?.text ?? '',
      stdout: child(output, 'StdOut')?.text ?? '', stderr: child(output, 'StdErr')?.text ?? '', attachments, diagnostics,
      backend, nativeId: node.attributes.testId}));
  }
  const summary = child(root, 'ResultSummary');
  const counters = child(summary, 'Counters');
  return {tests, results, runId: root.attributes.id ?? null, outcome: summary?.attributes.outcome ?? null,
    counters: counters ? Object.fromEntries(Object.entries(counters.attributes).map(([key, value]) => [key, Number(value)])) : {},
    attachments: descendants(root, 'ResultFile').map(file => ({path: attachmentPath(file.attributes.path), kind: 'test-attachment'}))};
}
