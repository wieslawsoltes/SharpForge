import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assert, documentHost, loadWorkspace, snapshot, waitFor} from './browser_designer_gate_harness.mjs';
import {programRecord} from './browser_designer_gate_fixtures.mjs';
import {distribution, traceInteraction, traceMeasurements} from './browser_designer_gate_timing.mjs';
import {observeCompilerRequests, observeSourceInput, collectSourceObservations} from './browser_designer_gate_source_observer.mjs';

const uri = 'SourceLatency.cs';
const lineCount = 3000;

/** Meaningful declarations exercise the real lexer, binder and compiler across exactly 3000 lines. */
function sourceFixture() {
  const lines = [
    'using Microsoft.UI.Xaml;', 'using Microsoft.UI.Xaml.Controls;', 'class SourceLatency', '{',
    '    public static Window Create()', '    {',
    '        var window = new Window() { Title = "Source latency" };',
    '        var canvas = new Canvas() { Width = 800, Height = 600 };',
    '        var action = new Button() { Name = "Action", Content = "Baseline", Width = 160, Height = 40 };',
    '        canvas.Children.Add(action);', '        window.Content = canvas;', '        return window;', '    }'
  ];
  for (let index = 0; lines.length < lineCount - 1; index++) {
    lines.push(`    private static int Sample${index}() { return ${index}; }`);
  }
  lines.push('}');
  return lines.join('\n');
}

async function selectLiteral(editor, value) {
  await editor.evaluate((element, value) => {
    const token = `Content = "${value}"`;
    const start = element.value.indexOf(token) + 'Content = "'.length;
    if (start < 'Content = "'.length || element.value.slice(start, start + value.length) !== value) {
      throw new Error('The expected source literal is missing.');
    }
    element.setSelectionRange(start, start + value.length);
  }, value);
}

async function prepareSource(page) {
  const source = sourceFixture();
  assert.equal(source.split('\n').length, lineCount);
  await loadWorkspace(page, [{path: uri, text: source}, programRecord], uri, 'split');
  await page.evaluate(uri => {
    sharpforge.setKeymap('visual-studio');
    sharpforge.designerDocuments.setAutoSync(uri, false);
  }, uri);
  const editor = documentHost(page, uri).locator('textarea.sf-input');
  await editor.focus();
  await selectLiteral(editor, 'Baseline');
  await page.keyboard.type('Obsolete');
  const obsolete = source.replace('"Baseline"', '"Obsolete"');
  await waitFor(page, ({uri, text}) => sharpforge.getState().files.find(file => file.uri === uri).text === text, {uri, text: obsolete});
  await selectLiteral(editor, 'Obsolete');
  return {source, obsolete, latest: source.replace('"Baseline"', '"Latest"')};
}

async function exerciseRequests(page, driver) {
  const timed = async (name, action) => {
    const started = performance.now();
    const result = await action();
    driver.push({name, milliseconds: performance.now() - started});
    return result;
  };
  await timed('Start obsolete read: protocol round trip', () => page.evaluate(() => window.__a18SourceObservation.start('obsolete')));
  await timed('Trusted replacement keys: protocol round trips plus browser work', () => page.keyboard.type('Latest'));
  await timed('Start latest read: protocol round trip', () => page.evaluate(() => window.__a18SourceObservation.start('latest')));
  await timed('Trusted navigation keys: protocol round trips plus browser work', async () => {
    for (let index = 0; index < 32; index++) {
      await page.keyboard.press(index % 2 ? 'ArrowLeft' : 'ArrowRight');
      const pending = await page.evaluate(() => window.__a18SourceObservation.data.requests
        .some(request => request.label === 'latest' && request.status === 'pending'));
      if (!pending && index >= 3) break;
    }
  });
  await waitFor(page, () => window.__a18SourceObservation.data.requests.length === 2 &&
    window.__a18SourceObservation.data.requests.every(request => request.status !== 'pending'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(uri => ({
    source: sharpforge.getState().files.find(file => file.uri === uri), editor: sharpforge.getEditorState(uri),
    accepted: sharpforge.designerDocuments.get(uri)
  }), uri);
}

function assertAcceptance(evidence, fixture) {
  const {input, worker} = evidence.observations;
  assert(input && worker && !input.error && !worker.error, 'Source or worker observations could not be collected.');
  assert.equal(input.dropped + worker.dropped, 0, 'Source latency evidence exceeded its bound.');
  const obsolete = input.requests.find(request => request.label === 'obsolete');
  const latest = input.requests.find(request => request.label === 'latest');
  assert.equal(obsolete?.status, 'rejected', 'The superseded source read caller was not canceled.');
  assert(obsolete.error.name === 'AbortError' || obsolete.error.code === 'SFSYNC_CANCELLED', JSON.stringify(obsolete.error));
  assert.equal(latest?.status, 'fulfilled');
  assert.equal(latest.result.state, 'synced');
  assert(latest.sourceVersion > obsolete.sourceVersion);
  assert.equal(latest.sourceText, fixture.latest);
  assert.equal(latest.acceptedPreview.sourceVersion, latest.sourceVersion);
  assert.equal(latest.acceptedPreview.content, 'Latest');
  const oldEnvelope = worker.events.find(event => event.method === 'designAnalyze' && event.sourceText === fixture.obsolete);
  const newEnvelope = worker.events.find(event => event.method === 'designAnalyze' && event.sourceText === fixture.latest);
  assert(oldEnvelope && newEnvelope, 'The production compiler worker did not observe both actual 3000-line source candidates.');
  assert.equal(oldEnvelope.operation, 'analyze');
  assert.equal(newEnvelope.operation, 'analyze');
  assert.equal(newEnvelope.sourceVersion, latest.sourceVersion);
  assert(worker.events.some(event => event.method === 'cancelRequest' && event.requestId === oldEnvelope.id),
    'No real cancelRequest envelope canceled the obsolete production worker request.');
  assert(!input.snapshots.some(value => value.content === 'Obsolete'), 'A superseded result was published into the preview.');
  assert.equal(evidence.final.source.text, fixture.latest);
  assert.equal(evidence.final.editor.value, fixture.latest);
  assert.equal(evidence.final.accepted.sourceSync.state, 'synced');
  assert.equal(evidence.final.accepted.document.nodes.find(node => node.id === 'action').properties.Content, 'Latest');
  const pendingKeys = input.keys.filter(event => event.pending.length);
  assert(pendingKeys.some(event => event.pending.includes('obsolete')), 'No trusted key arrived while the obsolete read was pending.');
  assert(pendingKeys.some(event => event.pending.includes('latest')), 'No trusted key arrived while the latest analysis was pending.');
  assert(input.inputs.some(event => event.pending.includes('obsolete') && event.trusted &&
    (event.type === 'beforeinput' || event.type === 'input') && event.inputType === 'insertText'),
    'A trusted editor insertion did not supersede the pending read.');
  assert(input.keys.every(event => event.trusted && Number.isFinite(event.queueDelayMs) && event.queueDelayMs >= -0.1),
    'Keyboard evidence has synthetic input or incompatible timestamp clocks.');
  assert(evidence.inputQueueMs.maximum <= 16, `3000-line analysis delayed trusted key input beyond 16 ms: ${JSON.stringify(evidence.inputQueueMs)}`);
  assert(evidence.renderer.rendererTasks.maximum <= 16,
    `3000-line analysis exceeded the main-thread task budget: ${JSON.stringify(evidence.renderer.rendererTasks)}`);
}

/** Production SourceSync and compiler-worker qualification; setup/build/debounce and driver round trips are not input latency. */
export async function sourceAnalysisLatency({page, context, results}) {
  const fixture = await prepareSource(page);
  const workers = page.workers().filter(worker => new URL(worker.url()).pathname.endsWith('/compiler.worker.js'));
  assert.equal(workers.length, 1, 'The latency case requires the one real Studio compiler worker.');
  const worker = workers[0];
  const driver = [];
  let trace;
  let final;
  let failure;
  try {
    await observeCompilerRequests(worker, uri);
    await observeSourceInput(page, uri);
    trace = await traceInteraction(context, page, async () => {
      await page.evaluate(() => performance.mark('a18-source-analysis-start'));
      try { final = await exerciseRequests(page, driver); }
      finally { await page.evaluate(() => performance.mark('a18-source-analysis-end')); }
    });
  } catch (error) {
    failure = error;
    trace = error.rendererTrace ?? trace;
  }
  const observations = await collectSourceObservations(page, worker);
  if (trace) await writeFile(resolve(results, 'browser-designer-source-latency-timeline.json'), JSON.stringify(trace));
  let renderer;
  if (trace) {
    try { renderer = traceMeasurements(trace, {startMark: 'a18-source-analysis-start', endMark: 'a18-source-analysis-end', minimumFrames: 0}); }
    catch (error) { failure ??= error; }
  }
  const input = observations.input;
  const pendingKeys = input?.keys?.filter(event => event.pending.length) ?? [];
  const evidence = {uri, lineCount, characters: fixture.source.length, workerURL: worker.url(), budgetMs: 16,
    inputQueueMs: distribution(pendingKeys.map(event => event.queueDelayMs)), renderer, driverRoundTrips: driver,
    asynchronousRequestElapsedMs: input?.requests?.map(request => ({label: request.label, status: request.status,
      milliseconds: request.completed === undefined ? null : request.completed - request.started})) ?? [],
    observations, final, failure: failure?.stack ?? null,
    measurement: 'Trusted editor key event.timeStamp to capture-handler performance.now; full overlapping CrRendererMain tasks.',
    cancellation: 'Raw cancelRequest envelopes, stale-caller settlement and latest public source/document are recorded. Running sync compilation is not preempted.',
    setup: '3000 source lines; manual public SourceSync reads bypass debounce only. Worker and DOM listeners observe without changing product behavior.'};
  await writeFile(resolve(results, 'browser-designer-source-latency.json'), JSON.stringify(evidence, null, 2));
  if (failure) throw failure;
  assertAcceptance(evidence, fixture);
  const after = await snapshot(page, uri);
  assert.deepEqual(after.document, final.accepted.document, 'The obsolete result committed after the latest request settled.');
  return evidence;
}
