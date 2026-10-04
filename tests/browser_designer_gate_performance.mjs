import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assert, documentHost, loadWorkspace, selectNode, snapshot, waitFor} from './browser_designer_gate_harness.mjs';
import {largeDesign, largeUri, programRecord} from './browser_designer_gate_fixtures.mjs';
import {distribution, traceInteraction, traceMeasurements} from './browser_designer_gate_timing.mjs';

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

async function visibleDragTarget(host) {
  const control = host.locator('.design-preview [data-sf-id="item255"]');
  await control.scrollIntoViewIfNeeded();
  const bounds = await control.boundingBox();
  assert(bounds && bounds.width && bounds.height);
  const origin = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
  const hit = await control.evaluate((element, point) => {
    const target = element.ownerDocument.elementFromPoint(point.x, point.y);
    const scroll = element.closest('.design-scroll');
    const visible = scroll.getBoundingClientRect();
    return {control: target === element || element.contains(target), selectionId: target?.closest('[data-selection-id]')?.dataset.selectionId,
      sameStage: target?.closest('.design-stage') === element.closest('.design-stage'), resize: !!target?.closest('[data-resize]'),
      tag: target?.tagName, className: target?.getAttribute('class'),
      scroller: {left: visible.left, top: visible.top, right: visible.right, bottom: visible.bottom,
        scrollLeft: scroll.scrollLeft, scrollTop: scroll.scrollTop}};
  }, origin);
  assert(hit.sameStage && !hit.resize && (hit.control || hit.selectionId === 'item255'),
    `The visible drag center must hit the selected control or its drag adorner: ${JSON.stringify({origin, hit})}`);
  return {bounds, origin, hit};
}

export async function largeScenePerformance({page, context, results}) {
  const viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight, devicePixelRatio}));
  const design = largeDesign();
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const started = performance.now();
  await loadWorkspace(page, [{path: largeUri, text: JSON.stringify(design)}, programRecord], largeUri);
  const host = documentHost(page, largeUri);
  const constructionMs = performance.now() - started;
  assert.equal((await snapshot(page, largeUri)).document.nodes.length, 5000);
  assert.equal(await host.locator('.design-preview [data-sf-id]').count(), 5000, 'The benchmark must render the entire real 5000-node scene.');
  const selections = await measuredSelections(page);
  const evidence = {nodes: 5000, viewport, constructionMs, selectionColdMs: selections.cold,
    selectionWarmMs: distribution(selections.warm), selectionWarmSamplesMs: selections.warm, heapBytes: selections.heapBytes,
    observedHeapDeltaBytes: heapBefore === null ? null : selections.heapBytes - heapBefore,
    phase: 'selection-complete', drag: null, maximumAdorners: null, budgetMs: 16,
    measurement: 'Real DOM selection plus forced layout; CDP renderer tasks during trusted mouse input.'};
  const evidencePath = resolve(results, 'browser-designer-5000-performance.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await selectNode(page, largeUri, 'item255');
  const before = (await snapshot(page, largeUri)).document;
  evidence.dragTarget = await visibleDragTarget(host);
  evidence.phase = 'drag-ready';
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  const {origin} = evidence.dragTarget;
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
  await writeFile(resolve(results, 'browser-designer-5000-timeline.json'), JSON.stringify(trace));
  const drag = traceMeasurements(trace);
  const after = (await snapshot(page, largeUri)).document;
  const previous = before.nodes.find(node => node.id === 'item255').properties;
  const next = after.nodes.find(node => node.id === 'item255').properties;
  Object.assign(evidence, {drag, gesture: {before: previous, after: next}, phase: 'drag-measured'});
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
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
  Object.assign(evidence, {maximumAdorners, phase: 'measurements-complete'});
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  assert(selections.cold <= 16, `5000-node cold selection exceeded 16 ms: ${selections.cold}`);
  assert(evidence.selectionWarmMs.maximum <= 16,
    `5000-node selection exceeded 16 ms: ${JSON.stringify(evidence.selectionWarmMs)}`);
  assert(drag.rendererTasks.maximum <= 16, `5000-node drag exceeded 16 ms: ${JSON.stringify(drag.rendererTasks)}`);
  return evidence;
}

/** The reference helper executes both managed engines and compares their actual DOM geometry with the designer at 0.5px. */
export async function layoutReferences(page) {
  const result = await page.evaluate(async () => {
    const {runDesignerLayoutReferences} = await import('./designer-layout-reference.js');
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
