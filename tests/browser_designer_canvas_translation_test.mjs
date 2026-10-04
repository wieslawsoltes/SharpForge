/** Independent geometry-equivalence gate; the original 5000-node performance fixture and interval are unchanged. */
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assert, createGate} from './browser_designer_gate_harness.mjs';

const gate = await createGate({resultsSubdirectory: 'canvas-translations'});
const evidence = {tolerance: .5, renderer: 'WinUIHost DOM', cases: []};
const save = () => writeFile(resolve(gate.results, 'browser-designer-canvas-translations.json'), JSON.stringify(evidence, null, 2));

function equivalent(row) {
  assert.deepEqual(row.errors, [], row.label);
  assert.deepEqual(row.retained.properties, row.reference.properties, row.label);
  for (const key of ['left', 'top', 'width', 'height']) {
    assert(Math.abs(row.retained.bounds[key] - row.reference.bounds[key]) <= evidence.tolerance,
      `${row.scene}/${row.label}/${key}: ${JSON.stringify({actual: row.retained.bounds, expected: row.reference.bounds})}`);
  }
  assert.deepEqual(row.retained.layout, row.reference.layout, `${row.label}: synchronous onLayout size changed.`);
  assert.equal(row.retained.style.origin, row.reference.style.origin, `${row.label}: transform origin changed.`);
  assert(row.retained.targetRetained && row.retained.neighborRetained, `${row.label}: native element identity changed.`);
  assert(row.retained.hitOwned && row.reference.hitOwned, `${row.label}: reference hit escaped its host.`);
  assert.equal(row.retained.hit, row.reference.hit, `${row.label}: native stacking or hit testing differs.`);
}

async function qualify(name, theme) {
  const rows = await gate.page.evaluate(async ({name, theme}) => {
    const fixture = window.__a18CanvasTranslation;
    const rows = [await fixture.load(name, theme)];
    rows.push(fixture.patch({Left: 118.25, Top: 90.5}, {label: 'fractional move'}));
    for (let index = 1; index <= 32; index++) {
      fixture.patch({Left: 80 + index / 4, Top: 70 + index / 8}, {flush: false});
    }
    rows.push(fixture.flush('queued repeated positions'));
    rows.push(fixture.patch({Left: 80, Top: 70}, {label: 'exact reversal'}));
    rows.push(fixture.patch({Left: undefined}, {label: 'clear Left'}));
    rows.push(fixture.patch({Left: 240, Top: 140}, {label: 'overlap with higher sibling'}));
    rows.push(fixture.patch({ZIndex: 2}, {label: 'stacking reset'}));
    rows.push(fixture.patch({Left: 241.5}, {label: 'move above sibling'}));
    fixture.patch({Width: 161, Height: 72}, {flush: false});
    fixture.patch({Left: 100, Top: 85}, {flush: false});
    rows.push(fixture.flush('resize then queued move'));
    rows.push(fixture.patch({Left: 110.5}, {label: 'move after resize'}));
    rows.push(fixture.external({op: 'set', id: 'target', property: 'Content', value: 'Updated content'}, 'style/source reset'));
    rows.push(fixture.patch({Left: 115.75, Top: 80.25}, {label: 'move after source reset'}));
    rows.push(fixture.reload());
    rows.push(fixture.patch({Left: 120, Top: 90}, {label: 'native input position'}));
    return rows;
  }, {name, theme});
  const record = {name, theme, rows};
  evidence.cases.push(record);
  await save();
  for (const row of rows) equivalent(row);
  const byLabel = new Map(rows.map(row => [row.label, row]));
  for (const label of ['fractional move', 'queued repeated positions', 'move above sibling', 'native input position']) {
    assert(byLabel.get(label).retained.translated, `${name}/${label} did not exercise retained translation.`);
  }
  assert.equal(byLabel.get('exact reversal').retained.style.transform, rows[0].retained.style.transform);
  assert.equal(byLabel.get('overlap with higher sibling').retained.hit, 'neighbor');
  assert.equal(byLabel.get('move above sibling').retained.hit, 'target');
  for (const label of ['stacking reset', 'resize then queued move', 'style/source reset', 'complete reload']) {
    assert.equal(byLabel.get(label).retained.translated, false, `${name}/${label} retained an invalid layout origin.`);
  }
  const final = rows.at(-1);
  for (const host of ['retained', 'reference']) {
    assert.equal(final[host].hit, 'target');
    await gate.page.mouse.click(final[host].center.x, final[host].center.y);
    await gate.page.keyboard.press('Enter');
  }
  record.nativeInput = await gate.page.evaluate(() => window.__a18CanvasTranslation.read('trusted input'));
  await save();
  equivalent(record.nativeInput);
  for (const host of ['retained', 'reference']) {
    const input = record.nativeInput.inputs.filter(item => item.host === host && item.id === 'target');
    assert(input.some(item => item.type === 'pointerdown' && item.trusted), `${host}: native pointer input was lost.`);
    assert(input.some(item => item.type === 'keydown' && item.key === 'Enter' && item.trusted), `${host}: keyboard input was lost.`);
    assert(input.filter(item => item.type === 'click' && item.trusted).length >= 2, `${host}: native activation was lost.`);
    assert.equal(record.nativeInput.events.filter(item => item.host === host && item.id === 'target' && item.event === 'Click').length, 2);
  }
  return record;
}

async function qualifyStylesheetOwnership(theme) {
  const rows = await gate.page.evaluate(async theme => {
    const fixture = window.__a18CanvasTranslation;
    const rows = [];
    for (const mode of ['identity', 'rotate']) {
      await fixture.load(mode === 'identity' ? 'identity' : 'rotate', theme);
      fixture.overrideTransform(mode);
      rows.push(fixture.patch({Left: 118.25, Top: 90.5}, {label: `initial ${mode} !important override`}));
    }
    await fixture.load('composite', theme);
    rows.push(fixture.patch({Left: 110, Top: 80}, {label: 'owned before stylesheet change'}));
    fixture.overrideTransform('rotate');
    rows.push(fixture.patch({Left: 125, Top: 85}, {label: 'stylesheet takes ownership after retained move'}));
    return rows;
  }, theme);
  const record = {name: 'stylesheet-ownership', theme, rows};
  evidence.cases.push(record);
  await save();
  for (const row of rows) {
    equivalent(row);
    assert.equal(row.retained.translated, row.label === 'owned before stylesheet change', row.label);
  }
  return record;
}

let failure;
try {
  await gate.page.evaluate(async () => {
    const {DesignerCanvasTranslationReference} = await import('./designer-canvas-translation-reference.js');
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./designer-canvas-translation-reference.css', location.href).href;
    await new Promise((resolve, reject) => {
      stylesheet.addEventListener('load', resolve, {once: true});
      stylesheet.addEventListener('error', () => reject(new Error('The same-origin reference stylesheet did not load.')), {once: true});
      document.head.append(stylesheet);
    });
    const root = document.createElement('div');
    root.dataset.a18CanvasTranslationReference = '';
    Object.assign(root.style, {position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'auto'});
    document.body.append(root);
    window.__a18CanvasTranslation = new DesignerCanvasTranslationReference(root);
  });
  for (const theme of ['light', 'dark']) {
    for (const name of ['identity', 'translate', 'rotate', 'scale', 'skew', 'composite', 'parent-affine']) {
      await gate.check(`Canvas ${name} translation matches a complete ${theme} render and native interaction`, () => qualify(name, theme));
    }
    await gate.check(`Canvas positions retain actual geometry under ${theme} !important stylesheet overrides`,
      () => qualifyStylesheetOwnership(theme));
  }
  assert.deepEqual(gate.report.errors, [], 'Browser page errors occurred.');
  assert.deepEqual(await gate.page.evaluate(() => window.__a18CspViolations), [], 'The production CSP was violated.');
} catch (error) {
  failure = error;
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  try { await save(); }
  finally { await gate.close(failure); }
}
