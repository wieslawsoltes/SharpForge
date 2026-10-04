import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assert, documentHost, documentPanel, loadWorkspace, snapshot, waitFor} from './browser_designer_gate_harness.mjs';
import {programRecord} from './browser_designer_gate_fixtures.mjs';

const uri = 'KeyboardPage.sfdesign.json';
const shortType = node => node.type.split('.').at(-1);
const selected = value => value.document.nodes.find(node => node.id === value.selection[0]);

function emptyPage() {
  return {version: 1, name: 'Keyboard page', width: 960, height: 640, root: 'page', styles: {}, templates: {},
    nodes: [{id: 'page', type: 'Page', properties: {Name: 'KeyboardPage', Width: 960, Height: 640}, children: []}]};
}

async function observeKeyboard(page) {
  await page.evaluate(uri => {
    const host = document.querySelector(`[data-designer-document="${uri}"]`);
    const region = host.querySelector('[aria-live="polite"][aria-atomic="true"]');
    if (!region) throw new Error('The keyboard page has no accessible announcement region.');
    const data = {keys: [], pointerEvents: [], liveRegionMessages: [], dropped: 0};
    const append = (field, value) => {
      if (data[field].length < 256) data[field].push(value);
      else data.dropped++;
    };
    const key = event => append('keys', {key: event.key, trusted: event.isTrusted, time: performance.now(),
      target: event.target.getAttribute?.('aria-label') ?? event.target.tagName});
    const pointer = event => {
      if (event.isTrusted && (event.type !== 'click' || event.detail > 0)) {
        append('pointerEvents', {type: event.type, detail: event.detail, time: performance.now()});
      }
    };
    const observer = new MutationObserver(() => append('liveRegionMessages', {text: region.textContent, time: performance.now()}));
    observer.observe(region, {subtree: true, childList: true, characterData: true});
    document.addEventListener('keydown', key, true);
    for (const event of ['pointerdown', 'mousedown', 'click']) document.addEventListener(event, pointer, true);
    window.__a18KeyboardEvidence = {stop() {
      observer.disconnect();
      document.removeEventListener('keydown', key, true);
      for (const event of ['pointerdown', 'mousedown', 'click']) document.removeEventListener(event, pointer, true);
      delete window.__a18KeyboardEvidence;
      return data;
    }};
  }, uri);
}

/** Every insertion uses trusted keys; snapshots only discover the identity selected by the product. */
async function insertFromKeyboard(page, type) {
  const before = await snapshot(page, uri);
  await page.keyboard.press('Insert');
  const toolbox = documentPanel(page, uri, 'designer-toolbox');
  const search = toolbox.getByRole('searchbox', {name: 'Search toolbox'});
  assert(await search.evaluate(element => element === document.activeElement), 'Insert did not focus Toolbox search.');
  await page.keyboard.press('Control+a');
  await page.keyboard.type(type);
  await page.keyboard.press('ArrowDown');
  const control = toolbox.locator(`[data-control="Microsoft.UI.Xaml.Controls.${type}"]`);
  assert(await control.evaluate(element => element === document.activeElement), `Search did not keyboard-focus ${type}.`);
  await page.keyboard.press('Enter');
  await waitFor(page, ({uri, count}) => sharpforge.designerDocuments.get(uri).document.nodes.length === count + 1,
    {uri, count: before.document.nodes.length});
  const after = await snapshot(page, uri);
  const inserted = selected(after);
  assert.equal(shortType(inserted), type);
  assert(!before.document.nodes.some(node => node.id === inserted.id), 'Enter did not select the newly inserted control.');
  assert(await control.evaluate(element => element === document.activeElement), 'Insertion lost its keyboard focus after Toolbox rendering.');
  await page.keyboard.press('Escape');
  assert(await documentHost(page, uri).locator('.design-scroll').evaluate(element => element === document.activeElement),
    'Escape did not return from Toolbox to the design surface.');
  return inserted.id;
}

async function selectParent(page, id) {
  for (let depth = 0; depth < 8; depth++) {
    if ((await snapshot(page, uri)).selection[0] === id) return;
    await page.keyboard.press('Escape');
  }
  throw new Error(`Keyboard parent navigation never reached ${id}.`);
}

async function createPage(page) {
  const surface = documentHost(page, uri).locator('.design-scroll');
  await surface.focus();
  assert.equal((await snapshot(page, uri)).selection[0], 'page');
  const grid = await insertFromKeyboard(page, 'Grid');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot(page, uri)).selection[0], 'page');
  await page.keyboard.press('Enter');
  assert.equal((await snapshot(page, uri)).selection[0], grid, 'Enter did not descend into the Grid.');
  const first = await insertFromKeyboard(page, 'TextBox');
  await selectParent(page, grid);
  const second = await insertFromKeyboard(page, 'TextBox');
  await selectParent(page, grid);
  const button = await insertFromKeyboard(page, 'Button');
  const value = await snapshot(page, uri);
  assert.equal(value.document.nodes.length, 5);
  assert.equal(shortType(value.document.nodes.find(node => node.id === value.document.root)), 'Page');
  assert.deepEqual(value.document.nodes.find(node => node.id === grid).children, [first, second, button]);
  assert.deepEqual(value.document.nodes.filter(node => node.id !== 'page').map(shortType).sort(), ['Button', 'Grid', 'TextBox', 'TextBox']);
  return {grid, first, second, button};
}

async function navigateAndTransform(page, ids) {
  await selectParent(page, 'page');
  for (const id of [ids.grid, ids.first, ids.second, ids.button]) {
    await page.keyboard.press('Tab');
    assert.equal((await snapshot(page, uri)).selection[0], id, 'Tab did not follow the page control order.');
  }
  await page.keyboard.press('Shift+Tab');
  assert.equal((await snapshot(page, uri)).selection[0], ids.second);
  await page.keyboard.press('Shift+Tab');
  const before = await snapshot(page, uri);
  assert.equal(before.selection[0], ids.first);
  const control = documentHost(page, uri).locator(`[data-sf-id="${ids.first}"]`);
  const width = selected(before).properties.Width ?? (await control.boundingBox()).width / before.zoom;
  await page.keyboard.down('Control');
  for (let repeat = 0; repeat < 8; repeat++) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Control');
  const resized = await snapshot(page, uri);
  assert.equal(selected(resized).properties.Width, width + 8);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await snapshot(page, uri)).document, before.document, 'Keyboard resize did not undo in one transaction.');
  await page.keyboard.press('Alt+ArrowRight');
  const reordered = await snapshot(page, uri);
  assert.deepEqual(reordered.document.nodes.find(node => node.id === ids.grid).children, [ids.second, ids.first, ids.button]);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await snapshot(page, uri)).document, before.document, 'Keyboard ordering did not undo in one transaction.');
  return {controlOrder: [ids.grid, ids.first, ids.second, ids.button], resizedWidth: width + 8, resizeRepeats: 8, undoTransactions: 1};
}

/** Headless trusted-key qualification is recorded separately from a native screen-reader transcript. */
export async function keyboardOnlyPage({page, results}) {
  await loadWorkspace(page, [{path: uri, text: JSON.stringify(emptyPage())}, programRecord], uri);
  await observeKeyboard(page);
  let failure;
  let interactions;
  try {
    const ids = await createPage(page);
    interactions = {created: ids, ...await navigateAndTransform(page, ids)};
  } catch (error) { failure = error; }
  const observation = await page.evaluate(() => window.__a18KeyboardEvidence.stop());
  const evidence = {uri, ...interactions, ...observation, failure: failure?.stack ?? null,
    nativeScreenReader: {status: 'not-run', reason: 'Headless Chromium records DOM live-region changes; no native screen reader is attached.'},
    setup: 'An empty Page is loaded through the public workspace API. Only initial focus and trusted keys perform the authoring flow.'};
  await writeFile(resolve(results, 'browser-designer-keyboard-page.json'), JSON.stringify(evidence, null, 2));
  if (failure) throw failure;
  assert(observation.keys.length && observation.keys.every(event => event.trusted), 'The page authoring did not use trusted keyboard input.');
  assert.deepEqual(observation.pointerEvents, [], 'The keyboard-only case used a pointer.');
  assert.equal(observation.dropped, 0, 'Keyboard evidence exceeded its bound.');
  return evidence;
}
