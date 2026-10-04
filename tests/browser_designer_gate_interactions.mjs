import {assert, documentHost, loadWorkspace, openPanel, overflow, previewOption, selectNode, snapshot, waitFor} from './browser_designer_gate_harness.mjs';
import {componentRecords, sourceRecords, sourceUri} from './browser_designer_gate_fixtures.mjs';

const sourceText = (page, uri) => page.evaluate(uri => sharpforge.getState().files.find(file => file.uri === uri).text, uri);
const authoredNode = (value, id) => value.document.nodes.find(node => node.id === id);

export async function propertyAndKeyboard(page) {
  await loadWorkspace(page, sourceRecords, sourceUri, 'split');
  await selectNode(page, sourceUri, 'action');
  const properties = await openPanel(page, sourceUri, 'designer-properties');
  await properties.locator('.design-property-search').fill('Width');
  const width = properties.locator('[data-property-row="Width"] input[data-property="Width"]');
  await width.fill('248');
  await width.press('Tab');
  await waitFor(page, uri => sharpforge.designerDocuments.get(uri).sourceSync.state === 'synced' &&
    sharpforge.getState().files.find(file => file.uri === uri).text.includes('Width = 248'), sourceUri);
  const edited = await sourceText(page, sourceUri);
  assert.equal(edited, sourceRecords[0].text.replace('Width = 160', 'Width = 248'), 'A property commit changed unrelated C# source.');
  assert.equal(authoredNode(await snapshot(page, sourceUri), 'action').properties.Width, 248);
  const surface = documentHost(page, sourceUri).locator('.design-scroll');
  await surface.focus();
  const before = await snapshot(page, sourceUri);
  for (let repeat = 0; repeat < 32; repeat++) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await waitFor(page, uri => sharpforge.designerDocuments.get(uri).sourceSync.state === 'synced', sourceUri);
  const moved = await snapshot(page, sourceUri);
  assert.equal(authoredNode(moved, 'action').properties.Left, authoredNode(before, 'action').properties.Left + 32);
  await surface.press('Control+z');
  await waitFor(page, ({uri, left}) => sharpforge.designerDocuments.get(uri).document.nodes.find(node => node.id === 'action').properties.Left === left,
    {uri: sourceUri, left: authoredNode(before, 'action').properties.Left});
  assert.deepEqual((await snapshot(page, sourceUri)).document, before.document, 'One undo did not restore the entire repeated-key gesture.');
  await waitFor(page, ({uri, edited}) => sharpforge.getState().files.find(file => file.uri === uri).text === edited, {uri: sourceUri, edited});
  await surface.press('Control+y');
  await waitFor(page, ({uri, left}) => sharpforge.designerDocuments.get(uri).document.nodes.find(node => node.id === 'action').properties.Left === left,
    {uri: sourceUri, left: authoredNode(moved, 'action').properties.Left});
  await surface.focus();
  const beforeCancel = await snapshot(page, sourceUri);
  await page.keyboard.down('ArrowDown');
  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowDown');
  assert.deepEqual((await snapshot(page, sourceUri)).document, beforeCancel.document, 'Escape committed a partial keyboard gesture.');
  return {property: 'Width', value: 248, repeatedKeyEvents: 32, undoTransactions: 1, cancelledGestureUnchanged: true};
}

export async function singleCommandBar(page) {
  await loadWorkspace(page, sourceRecords, sourceUri);
  await page.evaluate(uri => sharpforge.designerDocuments.setView(uri, {mode: 'design'}), sourceUri);
  const host = documentHost(page, sourceUri);
  const records = [];
  for (const theme of ['light', 'dark']) {
    for (const width of [480, 800, 1400]) {
      await page.setViewportSize({width, height: 1000});
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await host.locator('[role="toolbar"][aria-label="Designer commands"]').count(), 1);
      assert.equal(await host.locator('.design-toolbar').count(), 0, 'A retired toolbar row remains beside the command bar.');
      const geometry = await host.locator('.design-command-bar').evaluate(bar => {
        const rectangle = bar.getBoundingClientRect();
        const primary = bar.querySelector('.design-command-primary');
        const toggle = bar.querySelector('[data-design-action="more"]').getBoundingClientRect();
        const controls = [...primary.querySelectorAll('button,input,select')].filter(control => control.getClientRects().length);
        return {width: rectangle.width, height: rectangle.height, viewport: innerWidth,
          clipped: controls.filter(control => {
            const box = control.getBoundingClientRect();
            return box.left < rectangle.left - .5 || box.right > toggle.left + .5 || box.bottom > rectangle.bottom + .5;
          }).map(control => control.getAttribute('aria-label') || control.textContent),
          unnamed: controls.filter(control => !(control.getAttribute('aria-label') || control.textContent.trim() || control.title)).length};
      });
      assert(geometry.height <= 40, JSON.stringify({theme, width, geometry}));
      assert.deepEqual(geometry.clipped, [], JSON.stringify({theme, width, geometry}));
      assert.equal(geometry.unnamed, 0);
      const more = host.locator('button[data-design-action="more"]');
      await more.focus();
      await page.keyboard.press('Enter');
      const dialog = host.getByRole('dialog', {name: 'More designer commands'});
      assert(await dialog.isVisible());
      assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Keyboard focus did not enter overflow.');
      assert.equal(await dialog.locator('[data-preview-environment]').count(), 1, 'Environment controls left the single command bar.');
      for (const key of ['device', 'theme', 'contrast', 'direction', 'scale']) {
        assert(await dialog.locator(`[data-preview-option="${key}"]`).isVisible());
      }
      await page.keyboard.press('Escape');
      assert(await more.evaluate(element => element === document.activeElement));
      records.push({theme, width, ...geometry});
    }
  }
  await page.setViewportSize({width: 1600, height: 1000});
  const before = (await snapshot(page, sourceUri)).document;
  await previewOption(page, sourceUri, 'device', '390x844');
  assert.deepEqual((await snapshot(page, sourceUri)).document, before, 'A device preview mutated the authored artboard.');
  assert.equal(await host.locator('.design-stage').evaluate(element => element.style.width), '390px');
  await previewOption(page, sourceUri, 'device', 'document');
  return records;
}

export async function nestedComponent(page) {
  await loadWorkspace(page, componentRecords(), sourceUri);
  const host = documentHost(page, sourceUri);
  const card = host.locator('.design-preview [data-sf-id="card"]');
  await card.waitFor({state: 'visible'});
  assert((await card.innerText()).includes('Nested component content'), 'Nested component definition was not projected into the preview.');
  const parentBefore = (await snapshot(page, sourceUri)).document;
  await card.dblclick();
  await waitFor(page, () => sharpforge.designerDocuments.list().documents.some(document => document.uri === 'Card.cs'));
  const childHost = documentHost(page, 'Card.cs');
  assert(await childHost.locator('.design-preview').isVisible());
  assert.equal(await childHost.locator('.design-command-bar').count(), 1);
  assert.deepEqual((await snapshot(page, sourceUri)).document, parentBefore, 'Opening the component changed its parent instance.');
  await page.evaluate(uri => sharpforge.openFile(uri), sourceUri);
  await selectNode(page, sourceUri, 'card');
  await host.locator('.design-scroll').press('Shift+F10');
  const open = page.getByRole('menuitem', {name: 'Open component document', exact: true});
  assert(await open.isEnabled());
  await page.keyboard.press('Escape');
  return {parent: sourceUri, component: 'Card.cs', projectedText: 'Nested component content', parentUnchanged: true};
}
