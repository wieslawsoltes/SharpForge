import {
  assert, documentHost, loadWorkspace, openPanel, overflow, selectNode, snapshot, waitFor
} from './browser_designer_gate_harness.mjs';
import {designUri, previewRecords, sourceRecords, sourceUri} from './browser_designer_gate_fixtures.mjs';

export async function defaultEventAndInline(page) {
  await loadWorkspace(page, sourceRecords, sourceUri);
  const host = documentHost(page, sourceUri);
  const action = host.locator('.design-preview [data-sf-id="action"]');
  await action.dblclick();
  await waitFor(page, uri => {
    const session = sharpforge.designerDocuments.get(uri);
    return session.mode === 'code' && !session.sourceSync.pending && session.sourceSync.state === 'synced' &&
      Boolean(session.document.nodes.find(node => node.id === 'action').events?.Click);
  }, sourceUri);
  const eventName = (await snapshot(page, sourceUri)).document.nodes.find(node => node.id === 'action').events.Click;
  const source = await page.evaluate(uri => sharpforge.getState().files.find(file => file.uri === uri).text, sourceUri);
  assert(source.includes('action.Click +=') && source.includes(eventName.split('.').at(-1)), 'Default event did not create a real C# subscription.');
  const position = await page.evaluate(uri => sharpforge.getEditorState(uri).start, sourceUri);
  await page.evaluate(uri => sharpforge.designerDocuments.setView(uri, {mode: 'design'}), sourceUri);
  await action.dblclick();
  // The old caret is already at this handler; only the completed Code transition proves this navigation finished.
  await waitFor(page, ({uri, position}) => {
    const session = sharpforge.designerDocuments.get(uri);
    return session.mode === 'code' && !session.sourceSync.pending && session.sourceSync.state === 'synced' &&
      sharpforge.getEditorState(uri).start === position;
  }, {uri: sourceUri, position});
  assert.equal(await page.evaluate(uri => sharpforge.getState().files.find(file => file.uri === uri).text, sourceUri), source);
  await page.evaluate(uri => sharpforge.designerDocuments.setView(uri, {mode: 'design'}), sourceUri);
  await selectNode(page, sourceUri, 'action');
  const before = (await snapshot(page, sourceUri)).document;
  const surface = host.locator('.design-scroll');
  await surface.waitFor({state: 'visible'});
  await surface.press('F2');
  const inline = host.locator('[data-inline-text]');
  await inline.fill('Inline authored');
  await inline.press('Enter');
  await waitFor(page, uri => sharpforge.designerDocuments.get(uri).sourceSync.state === 'synced' &&
    sharpforge.getState().files.find(file => file.uri === uri).text.includes('Inline authored'), sourceUri);
  await host.locator('.design-scroll').press('Control+z');
  await waitFor(page, ({uri, before}) => JSON.stringify(sharpforge.designerDocuments.get(uri).document) === JSON.stringify(before),
    {uri: sourceUri, before});
  await action.click();
  await page.waitForTimeout(650);
  await action.click();
  await inline.waitFor({state: 'visible'});
  await inline.fill('Cancelled slow-click edit');
  await inline.press('Escape');
  assert.deepEqual((await snapshot(page, sourceUri)).document, before);
  return {defaultEvent: 'Click', handler: eventName, repeatedActivationChangedSource: false, inlineKey: 'F2', slowClickCancel: true};
}

async function drag(page, target, {dx, dy = 0, cancel = false}) {
  const bounds = await target.boundingBox();
  assert(bounds, 'The actual gesture target must be visible.');
  const start = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, {steps: 8});
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

export async function layoutGestures(page) {
  await loadWorkspace(page, previewRecords(), designUri);
  await selectNode(page, designUri, 'canvas');
  const panel = await openPanel(page, designUri, 'designer-layout');
  const host = documentHost(page, designUri);
  const action = host.locator('.design-preview [data-sf-id="action"]');
  const before = (await snapshot(page, designUri)).document;
  const initialBounds = await action.boundingBox();
  await panel.getByRole('button', {name: 'Convert to Grid', exact: true}).click();
  assert((await snapshot(page, designUri)).document.nodes.find(node => node.id === 'canvas').type.endsWith('.Grid'));
  const convertedBounds = await action.boundingBox();
  for (const key of ['x', 'y', 'width', 'height']) {
    assert(Math.abs(initialBounds[key] - convertedBounds[key]) <= .5, `Canvas→Grid changed ${key}: ${JSON.stringify(convertedBounds)}`);
  }
  const converted = (await snapshot(page, designUri)).document;
  await host.locator('.design-scroll').press('Control+z');
  assert.deepEqual((await snapshot(page, designUri)).document, before);
  await host.locator('.design-scroll').press('Control+y');
  assert.deepEqual((await snapshot(page, designUri)).document, converted);
  const menu = await overflow(page, designUri);
  await menu.locator('#designer-mode').selectOption('layout');
  await menu.press('Escape');
  await selectNode(page, designUri, 'action');
  const marginBefore = (await snapshot(page, designUri)).document;
  const zoom = (await snapshot(page, designUri)).zoom;
  const snap = Number(await host.locator('#designer-snap').inputValue());
  const anchor = host.locator('[data-control-id="action"][data-anchor-side="left"]');
  await drag(page, anchor, {dx: snap * 2 * zoom});
  assert.equal((await snapshot(page, designUri)).document.nodes.find(node => node.id === 'action').properties.Margin.Left, snap * 2);
  await host.locator('.design-scroll').press('Control+z');
  assert.deepEqual((await snapshot(page, designUri)).document, marginBefore);
  await drag(page, anchor, {dx: snap * 3 * zoom, cancel: true});
  assert.deepEqual((await snapshot(page, designUri)).document, marginBefore, 'Cancelling a real margin drag changed the document.');
  await host.locator('.design-scroll').focus();
  await page.keyboard.down('Alt');
  for (let repeat = 0; repeat < 32; repeat++) await page.keyboard.down('ArrowRight');
  assert.deepEqual((await snapshot(page, designUri)).document, marginBefore, 'Held ordering published intermediate document revisions.');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Alt');
  const ordered = (await snapshot(page, designUri)).document.nodes.find(node => node.id === 'canvas').children;
  assert.equal(ordered.at(-1), 'action');
  await host.locator('.design-scroll').press('Control+z');
  assert.deepEqual((await snapshot(page, designUri)).document, marginBefore, 'Held ordering required more than one undo.');
  return {conversionMaximumErrorPx: .5, marginDelta: snap * 2, cancelledMarginUnchanged: true, orderingKeyRepeats: 32, undoTransactions: 1};
}
