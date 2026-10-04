import {assert, documentHost, loadWorkspace, openPanel, previewOption, selectNode, snapshot, waitFor} from './browser_designer_gate_harness.mjs';
import {designUri, previewRecords} from './browser_designer_gate_fixtures.mjs';

async function expand(details) {
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
}

async function resourceThemes(page) {
  const host = documentHost(page, designUri);
  const action = host.locator('.design-preview [data-sf-id="action"]');
  const background = () => action.evaluate(element => getComputedStyle(element).backgroundColor);
  const before = (await snapshot(page, designUri)).document;
  assert.equal(await background(), 'rgb(16, 96, 48)');
  await previewOption(page, designUri, 'theme', 'light');
  assert.equal(await background(), 'rgb(160, 32, 16)');
  assert.deepEqual((await snapshot(page, designUri)).document, before, 'Theme selection changed authored resources.');
  const resources = await openPanel(page, designUri, 'designer-styles');
  await resources.getByLabel('Resource', {exact: true}).selectOption('AccentBrush');
  await resources.getByLabel('Resource theme', {exact: true}).selectOption('light');
  const hex = resources.getByLabel('Color hex', {exact: true});
  await hex.fill('#336699');
  await hex.press('Tab');
  assert.equal(await background(), 'rgb(51, 102, 153)', 'Editing the active resource variant did not update the actual surface.');
  const edited = (await snapshot(page, designUri)).document;
  assert.equal(edited.resources.AccentBrush.variants.light.Color.R, 51);
  await previewOption(page, designUri, 'theme', 'dark');
  assert.equal(await background(), 'rgb(16, 96, 48)', 'A light resource edit also changed the dark variant.');
  await previewOption(page, designUri, 'contrast', 'high');
  assert.equal(await host.locator('.design-preview [data-sf-id="canvas"]').evaluate(element =>
    getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)');
  assert.equal(await action.evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)');
  await previewOption(page, designUri, 'contrast', 'normal');
  await previewOption(page, designUri, 'direction', 'rtl');
  assert.equal(await host.locator('.design-preview').getAttribute('dir'), 'rtl');
  assert.deepEqual((await snapshot(page, designUri)).document, edited, 'Accessibility preview changed serialized resources.');
  await previewOption(page, designUri, 'direction', 'ltr');
  return {dark: 'rgb(16, 96, 48)', editedLight: 'rgb(51, 102, 153)', highContrast: true, flowPreviewOnly: true};
}

async function imageAsset(page) {
  await selectNode(page, designUri, 'picture');
  const properties = await openPanel(page, designUri, 'designer-properties');
  await properties.locator('.design-property-search').fill('Source');
  await properties.locator('[data-property-row="Source"]').getByRole('button', {name: 'Browse…', exact: true}).click();
  const picker = page.getByRole('dialog', {name: 'Choose project image'});
  await picker.getByLabel('Search image assets', {exact: true}).fill('Badge');
  await picker.locator('button.design-asset-item[title="Assets/Badge.svg"]').click();
  await waitFor(page, uri => {
    const image = document.querySelector(`[data-designer-document="${uri}"] .design-preview img[data-sf-id="picture"]`);
    return image?.complete && image.naturalWidth === 24 && image.naturalHeight === 16 && image.src.startsWith('blob:');
  }, designUri);
  const value = (await snapshot(page, designUri)).document.nodes.find(node => node.id === 'picture').properties.Source;
  assert(value.endsWith('Assets/Badge.svg') && !value.startsWith('blob:'), 'The serialized property must retain a project URI.');
  assert(await properties.locator('.design-asset-selected').isVisible());
  return {asset: value, naturalWidth: 24, naturalHeight: 16, authorizedBlobPreview: true};
}

async function visualState(page) {
  await selectNode(page, designUri, 'action');
  const resources = await openPanel(page, designUri, 'designer-styles');
  await resources.getByLabel('Resource', {exact: true}).selectOption('Accent');
  const states = resources.locator('.design-state-editor');
  await expand(states);
  await states.getByRole('button', {name: 'Add state…', exact: true}).click();
  const create = page.getByRole('dialog', {name: 'Add visual state'});
  await create.getByLabel('Group', {exact: true}).fill('CommonStates');
  await create.getByLabel('State', {exact: true}).fill('PointerOver');
  await create.getByRole('button', {name: 'Create state', exact: true}).click();
  await expand(states);
  const row = states.locator('.design-state-row').filter({hasText: 'PointerOver'});
  await row.getByRole('button', {name: 'Record property…', exact: true}).click();
  const record = page.getByRole('dialog', {name: 'Record PointerOver property'});
  await record.getByLabel('Target', {exact: true}).selectOption('action');
  await record.getByLabel('Property', {exact: true}).selectOption('Width');
  await record.getByLabel('Value', {exact: true}).fill('320');
  await record.getByRole('button', {name: 'Record setter', exact: true}).click();
  await expand(states);
  const before = (await snapshot(page, designUri)).document;
  await row.getByRole('button', {name: 'Preview', exact: true}).click();
  const action = documentHost(page, designUri).locator('.design-preview [data-sf-id="action"]');
  assert.equal(await action.evaluate(element => getComputedStyle(element).width), '320px');
  assert.deepEqual((await snapshot(page, designUri)).document, before, 'Previewing a state authored the temporary values.');
  assert.equal(before.nodes.find(node => node.id === 'action').properties.Width, 160);
  const strip = resources.locator('.design-preview-strip');
  await expand(strip);
  // Native details toggle dispatch triggers the lazy render after the summary click.
  await strip.locator('figure[data-theme="light"]').first().waitFor({state: 'attached'});
  await strip.locator('figure[data-theme="dark"]').first().waitFor({state: 'attached'});
  assert(await strip.locator('figure[data-theme="light"]').count() > 0);
  assert(await strip.locator('figure[data-theme="dark"]').count() > 0);
  return {group: 'CommonStates', state: 'PointerOver', previewWidth: 320, authoredWidth: 160, themeInstances: true};
}

async function adaptiveState(page) {
  await selectNode(page, designUri, 'action');
  const panel = await openPanel(page, designUri, 'designer-layout');
  await panel.getByRole('button', {name: 'Add breakpoint', exact: true}).click();
  await panel.getByRole('button', {name: /^State1 ·/}).click();
  const minimum = panel.getByLabel('Minimum width', {exact: true});
  await minimum.fill('700');
  await minimum.press('Tab');
  await panel.getByLabel('State override property', {exact: true}).selectOption('Width');
  await panel.getByLabel('State override value', {exact: true}).fill('280');
  await panel.getByRole('button', {name: 'Set override', exact: true}).click();
  await panel.getByRole('button', {name: 'Automatic preview', exact: true}).click();
  const before = (await snapshot(page, designUri)).document;
  const action = documentHost(page, designUri).locator('.design-preview [data-sf-id="action"]');
  assert.equal(await action.evaluate(element => getComputedStyle(element).width), '280px');
  await previewOption(page, designUri, 'device', '390x844');
  assert.equal(await action.evaluate(element => getComputedStyle(element).width), '160px');
  await previewOption(page, designUri, 'device', 'document');
  assert.equal(await action.evaluate(element => getComputedStyle(element).width), '280px');
  assert.deepEqual((await snapshot(page, designUri)).document, before, 'Changing viewport serialized adaptive overrides as local properties.');
  return {breakpoint: 700, wideWidth: 280, phoneWidth: 160, authoredWidth: 160};
}

export async function authoredPreviews(page) {
  await loadWorkspace(page, previewRecords(), designUri);
  await selectNode(page, designUri, 'action');
  return {resources: await resourceThemes(page), asset: await imageAsset(page),
    visualState: await visualState(page), adaptive: await adaptiveState(page)};
}
