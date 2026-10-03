import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assert, documentHost, loadWorkspace, selectNode, snapshot, waitFor} from './browser_designer_gate_harness.mjs';
import {largeDesign, largeUri, programRecord} from './browser_designer_gate_fixtures.mjs';

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = value => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))] ?? null;
  return {samples: sorted.length, median: percentile(.5), p95: percentile(.95), p99: percentile(.99),
    maximum: sorted.at(-1) ?? null, over16ms: sorted.filter(value => value > 16).length};
}

async function traceInteraction(context, page, action) {
  const client = await context.newCDPSession(page);
  await client.send('Tracing.start', {categories: 'toplevel,devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream'});
  let failure;
  try { await action(); } catch (error) { failure = error; }
  const completed = new Promise(resolve => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  const {stream} = await completed;
  let json = '';
  for (;;) {
    const part = await client.send('IO.read', {handle: stream});
    json += part.base64Encoded ? Buffer.from(part.data, 'base64').toString('utf8') : part.data;
    if (part.eof) break;
  }
  await client.send('IO.close', {handle: stream});
  await client.detach();
  if (failure) throw failure;
  return JSON.parse(json);
}

/** Top-level renderer tasks include event dispatch, queued gesture frames and resulting layout without double-counting nested calls. */
function traceMeasurements(trace) {
  const events = trace.traceEvents;
  const renderers = new Set(events.filter(event => event.ph === 'M' && event.name === 'thread_name' &&
    event.args?.name === 'CrRendererMain').map(event => `${event.pid}:${event.tid}`));
  const start = events.find(event => event.name === 'a18-drag-start');
  const finish = events.find(event => event.name === 'a18-drag-end');
  assert(start && finish, 'The browser trace must include both interaction boundary marks.');
  const relevant = events.filter(event => renderers.has(`${event.pid}:${event.tid}`) && event.ph === 'X' &&
    event.ts >= start.ts && event.ts + (event.dur ?? 0) <= finish.ts);
  const tasks = relevant.filter(event => event.name === 'RunTask' || event.name === 'ThreadControllerImpl::RunTask');
  const frames = relevant.filter(event => event.name === 'FireAnimationFrame');
  assert(tasks.length, 'The trace did not expose renderer main-thread task durations; no frame-budget result can be claimed.');
  assert(frames.length >= 20, 'The drag did not exercise enough real animation-frame gesture callbacks.');
  return {rendererTasks: distribution(tasks.map(event => event.dur / 1000)),
    animationCallbacks: distribution(frames.map(event => event.dur / 1000)),
    longestTasks: [...tasks].sort((left, right) => right.dur - left.dur).slice(0, 10)
      .map(event => ({name: event.name, milliseconds: event.dur / 1000, timestampMicroseconds: event.ts}))};
}

async function measuredSelections(page) {
  return page.evaluate(async uri => {
    const times = [];
    for (let index = 0; index < 61; index++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const id = `item${100 + index * 17}`;
      const started = performance.now();
      sharpforge.designerDocuments.select(uri, [id]);
      const selected = document.querySelector(`[data-designer-document="${uri}"] [data-sf-id="${id}"]`);
      selected.getBoundingClientRect();
      times.push(performance.now() - started);
    }
    return {cold: times[0], warm: times.slice(1), heapBytes: performance.memory?.usedJSHeapSize ?? null};
  }, largeUri);
}

export async function largeScenePerformance({page, context, results}) {
  const design = largeDesign();
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const started = performance.now();
  await loadWorkspace(page, [{path: largeUri, text: JSON.stringify(design)}, programRecord], largeUri);
  const host = documentHost(page, largeUri);
  const constructionMs = performance.now() - started;
  assert.equal((await snapshot(page, largeUri)).document.nodes.length, 5000);
  assert.equal(await host.locator('.design-preview [data-sf-id]').count(), 5000, 'The benchmark must render the entire real 5000-node scene.');
  const selections = await measuredSelections(page);
  await selectNode(page, largeUri, 'item255');
  const before = (await snapshot(page, largeUri)).document;
  const control = host.locator('.design-preview [data-sf-id="item255"]');
  const bounds = await control.boundingBox();
  assert(bounds && bounds.width && bounds.height);
  const origin = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
  const trace = await traceInteraction(context, page, async () => {
    await page.mouse.move(origin.x, origin.y);
    await page.evaluate(() => performance.mark('a18-drag-start'));
    await page.mouse.down();
    for (let index = 1; index <= 60; index++) {
      await page.mouse.move(origin.x + index / 2, origin.y + index / 4);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    await page.mouse.up();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => performance.mark('a18-drag-end'));
  });
  const drag = traceMeasurements(trace);
  await writeFile(resolve(results, 'browser-designer-5000-timeline.json'), JSON.stringify(trace));
  const after = (await snapshot(page, largeUri)).document;
  const previous = before.nodes.find(node => node.id === 'item255').properties;
  const next = after.nodes.find(node => node.id === 'item255').properties;
  assert(next.Left !== previous.Left || next.Top !== previous.Top, 'The measured mouse drag did not move the selected control.');
  assert.equal(next.Width, previous.Width, 'The measured gesture resized a handle instead of dragging the control.');
  assert.equal(next.Height, previous.Height);
  await host.locator('.design-scroll').press('Control+z');
  assert.deepEqual((await snapshot(page, largeUri)).document, before, 'Large-scene drag did not undo as one transaction.');
  await page.evaluate(uri => {
    const design = sharpforge.designerDocuments.get(uri).document;
    sharpforge.designerDocuments.select(uri, design.nodes.map(node => node.id));
  }, largeUri);
  await waitFor(page, uri => document.querySelector(`[data-designer-document="${uri}"] .design-overlay`)
    ?.dataset.selectionCount === '5000', largeUri);
  const maximumAdorners = await host.locator('.design-selection').count();
  assert(maximumAdorners > 0 && maximumAdorners <= 200, 'The 5000-control visible selection adorner bound was exceeded.');
  const evidence = {nodes: 5000, constructionMs, selectionColdMs: selections.cold,
    selectionWarmMs: distribution(selections.warm), heapBytes: selections.heapBytes, drag, maximumAdorners,
    observedHeapDeltaBytes: heapBefore === null ? null : selections.heapBytes - heapBefore,
    budgetMs: 16, measurement: 'Real DOM selection plus forced layout; CDP renderer tasks during trusted mouse input.'};
  await writeFile(resolve(results, 'browser-designer-5000-performance.json'), JSON.stringify(evidence, null, 2));
  assert(selections.cold <= 16, `5000-node cold selection exceeded 16 ms: ${selections.cold}`);
  assert(evidence.selectionWarmMs.maximum <= 16,
    `5000-node selection exceeded 16 ms: ${JSON.stringify(evidence.selectionWarmMs)}`);
  assert(drag.rendererTasks.maximum <= 16, `5000-node drag exceeded 16 ms: ${JSON.stringify(drag.rendererTasks)}`);
  return evidence;
}

/** The reference helper executes both managed engines and compares their actual DOM geometry with the designer at 0.5px. */
export async function layoutReferences(page) {
  const result = await page.evaluate(async () => {
    const {runDesignerLayoutReferences} = await import(new URL('designer-layout-reference.js', location.href).href);
    const root = document.createElement('div');
    root.dataset.a18LayoutReference = '';
    Object.assign(root.style, {position: 'absolute', left: '0', top: '0', width: '1800px', pointerEvents: 'none'});
    document.body.append(root);
    try { return await runDesignerLayoutReferences(root, {tolerance: .5}); }
    finally { root.remove(); }
  });
  assert.equal(result.length, 10, 'All five reference scenes must run independently on source VM and direct CIL.');
  assert(result.every(row => row.pass), JSON.stringify(result.filter(row => !row.pass)));
  assert.deepEqual([...new Set(result.map(row => row.backend))].sort(), ['cil', 'source']);
  return result;
}
