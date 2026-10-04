import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {assessEvaluation} from '../scripts/workbench-lazy-evaluation/assessment.js';
import {captureEvaluation, enableThreadMetrics} from '../scripts/workbench-lazy-evaluation/capture.js';
import {deferredModules, entryDurations, entryModule, metricValues, overlayAssets, pairOrder, protocol}
  from '../scripts/workbench-lazy-evaluation/protocol.js';
import {evaluationServer, verifyOverlays} from '../scripts/workbench-lazy-evaluation/server.js';
import {sha256} from '../scripts/conformance/build-identity.js';

const html = '<!doctype html><html><head><title>fixture</title></head><body>'
  + '<script type="module" src="./studio.js"></script></body></html>';
const policy = "default-src 'self'; script-src 'self'; object-src 'none'";
const hash = character => character.repeat(64);
const metrics = (script, timestamp) => [
  {name: 'ScriptDuration', value: script}, {name: 'V8CompileDuration', value: .01}, {name: 'Timestamp', value: timestamp}
];
const overlayRows = () => overlayAssets(html).map(({path, bytes, sha256}) => ({path, bytes, sha256}));

function completeReport(eagerMs = 210) {
  const source = {commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true};
  const assets = [{path: 'studio.js', bytes: 1, sha256: hash('4')}];
  const report = {protocol: protocol.id, captureStatus: 'completed', serverErrors: [],
    environment: {engine: 'chromium', timeDomain: 'threadTicks', browserVersion: 'fixture-only'},
    identity: {source, driver: {...source}, harness: {sha256: hash('1')},
      artifact: {stable: true, assetCount: 1, assetsSha256: hash('2'), manifestSha256: hash('3')},
      served: ['before', 'after'].map(phase => ({phase, matched: true, assets, assetsSha256: sha256(JSON.stringify(assets)),
        expectedManifestSha256: hash('3')}))},
    overlays: [overlayRows(), overlayRows()], runs: []};
  for (let pair = 0; pair < protocol.pairs; pair++) {
    for (const [order, variant] of pairOrder(pair).entries()) {
      const baselineMetrics = metrics(0, 1);
      const entryEvent = {title: protocol.marker, metrics: metrics((variant === 'lazy' ? 200 : eagerMs) / 1000, 2)};
      report.runs.push({pair, order, variant, timeDomain: 'threadTicks', browserVersion: 'fixture-only',
        artifactSha256: hash('2'), completed: true, productReady: true, errors: [], baselineMetrics, entryEvent,
        metricEvents: [entryEvent], deferredRequests: variant === 'lazy' ? [] : [...deferredModules],
        ...entryDurations(baselineMetrics, entryEvent)});
    }
  }
  return report;
}

test('counterfactual has identical scaffolding and five explicit static imports before the shipped entry', () => {
  const lazy = entryModule('lazy'), eager = entryModule('eager');
  assert.equal(eager.endsWith(lazy), true);
  assert.equal(eager.split('\n').length - lazy.split('\n').length, 5);
  for (const name of deferredModules) assert.equal(eager.includes(`import './${name}';`), true);
  assert.equal(lazy, `import './studio.js';\nconsole.timeStamp('${protocol.marker}');\n`);
  assert.throws(() => entryModule('historical'), /Unknown/);
  const assets = overlayAssets(html);
  assert.equal(assets.length, 4);
  for (const asset of assets.filter(asset => asset.path.endsWith('.html'))) {
    assert.equal(asset.body.replace(/\.\/_sf-(lazy|eager)-entry\.js/, './studio.js'), html);
  }
  assert.throws(() => overlayAssets(html.replace('</body>', '<script></script></body>')), /single/);
  assert.throws(() => overlayAssets(html.replace('./studio.js', './different.js')), /single/);
});

test('complete paired assessment retains every signed observation and reports a point observation', () => {
  const report = completeReport();
  const firstEager = report.runs.find(run => run.variant === 'eager');
  firstEager.entryEvent.metrics = metrics(.199, 2);
  Object.assign(firstEager, entryDurations(firstEager.baselineMetrics, firstEager.entryEvent));
  const result = assessEvaluation(report);
  assert.equal(result.passed, true);
  assert.equal(result.pairs.length, 12);
  assert.equal(result.pairs[0].savedMs, -1);
  assert.equal(result.savedMs, 109);
  assert.equal(result.dispersion.positivePairs, 11);
  assert.equal(result.dispersion.negativePairs, 1);
  assert.match(result.uncertainty, /not statistical proof/);
  assert.equal(assessEvaluation(completeReport(200)).passed, false);
  assert.equal(assessEvaluation(completeReport(199)).passed, false);
});

test('missing marker, title, duplicate marker and incomplete fixed sample count are rejected', () => {
  for (const mutate of [report => report.runs.pop(), report => report.runs[0].metricEvents = [],
    report => report.runs[0].entryEvent.title = 'other', report => report.runs[0].metricEvents.push(report.runs[0].entryEvent),
    report => report.runs[0].pair = 1, report => report.runs[0].variant = 'eager']) {
    const report = completeReport();
    mutate(report);
    assert.throws(() => assessEvaluation(report));
  }
});

test('nonfinite, missing, duplicate, negative and inconsistent metric values fail closed', () => {
  for (const value of [NaN, Infinity, -1]) assert.throws(() => metricValues(metrics(value, 1)), /Invalid/);
  assert.throws(() => metricValues([{name: 'Timestamp', value: 1}]), /Missing/);
  assert.throws(() => metricValues([...metrics(1, 2), {name: 'Timestamp', value: 3}]), /Invalid/);
  assert.throws(() => entryDurations(metrics(2, 1), {title: protocol.marker, metrics: metrics(1, 2)}), /delta/);
  assert.throws(() => entryDurations(metrics(0, 1), {title: protocol.marker, metrics: metrics(Number.MAX_VALUE, 2)}), /delta/);
  assert.throws(() => entryDurations(metrics(0, 1), undefined), /marker/);
  const report = completeReport();
  report.runs[0].scriptDurationMs = 1;
  assert.throws(() => assessEvaluation(report), /raw/);
});

test('source, served assets, overlays, engine, module graph and product failures invalidate assessment', () => {
  for (const mutate of [report => report.identity.driver.commit = 'c'.repeat(40),
    report => report.identity.artifact.stable = false, report => report.identity.served[1].assetsSha256 = hash('5'),
    report => report.overlays[1][0].sha256 = hash('6'), report => report.environment.engine = 'firefox',
    report => report.runs[1].timeDomain = 'timeTicks', report => report.runs[0].errors.push({message: 'product failed'}),
    report => report.runs[0].artifactSha256 = hash('7'), report => report.runs[1].deferredRequests = [],
    report => report.runs[0].productReady = false, report => report.serverErrors.push({message: 'proxy failed'})]) {
    const report = completeReport();
    mutate(report);
    assert.throws(() => assessEvaluation(report));
  }
});

test('unsupported threadTicks rejects without a timing fallback', async () => {
  const calls = [];
  await assert.rejects(enableThreadMetrics({async send(method, parameters) {
    calls.push({method, parameters});
    throw new Error('Thread ticks are not supported');
  }}), /threadTicks.*unavailable/);
  assert.deepEqual(calls, [{method: 'Performance.enable', parameters: {timeDomain: 'threadTicks'}}]);
});

function fakeEngine({missingMarker = false, unsupported = false} = {}) {
  const ownership = {launches: 0, closes: 0};
  const session = {listener: null, async send(method) {
    if (unsupported && method === 'Performance.enable') throw new Error('unsupported');
    return {metrics: metrics(0, 1)};
  }, on(name, listener) { assert.equal(name, 'Performance.metrics'); this.listener = listener; }, async detach() {}};
  const page = {on() {}, async goto() {
    if (!missingMarker) session.listener({title: protocol.marker, metrics: metrics(.2, 2)});
    return {ok: () => true, headers: () => ({'content-security-policy': policy})};
  }, async evaluate() { return true; }};
  const context = {async newPage() { return page; }, async route() {}, async newCDPSession() { return session; }};
  return {ownership, async launchServer() {
    ownership.launches++;
    return {wsEndpoint: () => 'fixture', async close() { ownership.closes++; }, async kill() { assert.fail('unexpected forced close'); }};
  }, async connect() { return {version: () => 'fixture-only', async newContext() { return context; }}; }};
}

test('capture owns a fresh process for each sample and closes it on unsupported clocks or missing markers', async () => {
  const engine = fakeEngine();
  for (let index = 0; index < 2; index++) {
    const run = {variant: 'lazy'};
    await captureEvaluation(engine, 'http://127.0.0.1/', run);
    assert.equal(run.completed, true);
    assert.equal(run.scriptDurationMs, 200);
  }
  assert.deepEqual(engine.ownership, {launches: 2, closes: 2});
  const unsupported = fakeEngine({unsupported: true});
  await assert.rejects(captureEvaluation(unsupported, 'http://127.0.0.1/', {variant: 'lazy'}), /threadTicks/);
  assert.deepEqual(unsupported.ownership, {launches: 1, closes: 1});
  const stalled = fakeEngine({missingMarker: true});
  await assert.rejects(captureEvaluation(stalled, 'http://127.0.0.1/', {variant: 'lazy'}, {timeoutMs: 4020}), /deadline/);
  assert.deepEqual(stalled.ownership, {launches: 1, closes: 1});
});

test('real local HTTP overlay preserves product bytes/CSP and verifies all four served fixture resources', async t => {
  const javascript = 'export const product = 42;\n';
  const upstream = createServer((request, response) => {
    const body = request.url === '/index.html' ? html : javascript;
    response.writeHead(200, {'content-security-policy': policy, 'content-type': 'text/plain'});
    response.end(body);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  });
  const server = await evaluationServer(`http://127.0.0.1:${upstream.address().port}/`);
  t.after(() => server.stop());
  const product = await fetch(new URL('/studio.js', server.url));
  assert.equal(await product.text(), javascript);
  assert.equal(product.headers.get('content-security-policy'), policy);
  const rows = await verifyOverlays(server, AbortSignal.timeout(1000));
  assert.deepEqual(rows, overlayRows());
  const forbidden = await fetch(new URL('/studio.js?unexpected=1', server.url));
  assert.equal(forbidden.status, 400);
  await assert.rejects(evaluationServer(server.url + 'nested/'), /root URL/);
});
