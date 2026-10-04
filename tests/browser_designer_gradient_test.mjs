import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assert, createGate} from './browser_designer_gate_harness.mjs';

const gate = await createGate({resultsSubdirectory: 'gradient-presentation'});
const evidence = {renderer: 'WinUIHost DOM/SVG; browser Canvas raster reference', channelTolerance: 3, cases: []};
const save = () => writeFile(resolve(gate.results, 'gradient-pixels.json'), JSON.stringify(evidence, null, 2));

async function install() {
  await gate.page.evaluate(async () => {
    const {WinUIHost, createWinUIApp} = await import('./packages/winui/src/index.js');
    const root = document.createElement('div');
    Object.assign(root.style, {position: 'fixed', inset: '0', zIndex: '2147483647', background: 'white', overflow: 'auto'});
    document.body.append(root);
    const hostRoot = document.createElement('div');
    const appRoot = document.createElement('div');
    root.append(hostRoot, appRoot);
    const errors = [];
    const host = new WinUIHost(hostRoot, {backend: 'dom', onError: error => errors.push(error.message)});
    const color = (r, g, b, a = 255) => ({valueType: 'Windows.UI.Color', A: a, R: r, G: g, B: b});
    const brush = {valueType: 'Microsoft.UI.Xaml.Media.LinearGradientBrush', Opacity: .5,
      StartPoint: {X: .2, Y: .1}, EndPoint: {X: .7, Y: .8},
      GradientStops: [{Color: color(255, 0, 0), Offset: 0}, {Color: color(0, 0, 255), Offset: 1}]};
    const node = (id, type, properties, collections = {}) => ({id, type, properties, collections, events: []});
    host.load({version: 1, windows: ['window'], nodes: [
      node('window', 'Microsoft.UI.Xaml.Window', {Content: {$ref: 'stack'}}),
      node('stack', 'Microsoft.UI.Xaml.Controls.StackPanel', {Width: 500},
        {Children: [{$ref: 'paint'}, {$ref: 'text'}, {$ref: 'canvas'}]}),
      node('paint', 'Microsoft.UI.Xaml.Controls.Border', {Width: 240, Height: 80, Background: brush}),
      node('text', 'Microsoft.UI.Xaml.Controls.TextBlock', {Text: 'Portable gradient glyphs', FontSize: 28, Foreground: brush}),
      node('canvas', 'Microsoft.UI.Xaml.Controls.Canvas', {Width: 300, Height: 100}, {Children: [{$ref: 'shape'}]}),
      node('shape', 'Microsoft.UI.Xaml.Shapes.Ellipse', {Width: 200, Height: 80, Fill: brush, Stroke: brush, StrokeThickness: 4})
    ]});
    await host.settled();
    const app = createWinUIApp(appRoot, {backend: 'dom', onError: error => errors.push(error.message)});
    const win = new app.Microsoft.UI.Xaml.Window();
    const button = new app.Microsoft.UI.Xaml.Controls.Button();
    button.Width = 240;
    button.Height = 60;
    button.Content = 'Native JavaScript gradient consumer';
    const linear = new app.Microsoft.UI.Xaml.Media.LinearGradientBrush();
    const stop = new app.Microsoft.UI.Xaml.Media.GradientStop();
    stop.Color = app.Windows.UI.Color.FromArgb(255, 255, 0, 0);
    linear.GradientStops.Add(stop);
    button.Background = linear;
    win.Content = button;
    win.Activate();
    await app.settled();
    window.__a18Gradient = {root, host, app, brush, linear, stop, button, errors};
  });
}

async function raster(label, width, height) {
  const row = await gate.page.evaluate(async ({label, width, height}) => {
    const fixture = window.__a18Gradient;
    fixture.host.apply([{op: 'set', id: 'paint', property: 'Width', value: width},
      {op: 'set', id: 'paint', property: 'Height', value: height}]);
    fixture.host.flush();
    const element = fixture.host.elements.get('paint');
    const css = getComputedStyle(element);
    const match = /url\("(data:image\/svg\+xml,[^"]+)"\)/.exec(css.backgroundImage);
    if (!match) throw new Error('The actual DOM Background did not contain SVG paint.');
    const image = new Image();
    image.src = match[1];
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const points = [[2, 2], [Math.floor(width / 2), Math.floor(height / 2)], [width - 3, height - 3], [width - 3, 3]];
    return {label, width, height, brush: fixture.brush, bounds: {width: element.offsetWidth, height: element.offsetHeight},
      css: {backgroundImage: css.backgroundImage, backgroundSize: css.backgroundSize, backgroundOrigin: css.backgroundOrigin},
      pixels: points.map(([x, y]) => ({x, y, rgba: [...context.getImageData(x, y, 1, 1).data]})), errors: fixture.errors};
  }, {label, width, height});
  evidence.cases.push(row);
  await save();
  assert.deepEqual(row.bounds, {width, height});
  assert.deepEqual(row.errors, []);
  assert.equal(row.css.backgroundSize, '100% 100%');
  const start = {x: row.brush.StartPoint.X * width, y: row.brush.StartPoint.Y * height};
  const dx = (row.brush.EndPoint.X - row.brush.StartPoint.X) * width;
  const dy = (row.brush.EndPoint.Y - row.brush.StartPoint.Y) * height;
  for (const pixel of row.pixels) {
    const ratio = Math.max(0, Math.min(1, ((pixel.x + .5 - start.x) * dx + (pixel.y + .5 - start.y) * dy) / (dx * dx + dy * dy)));
    const expected = [255 * (1 - ratio), 0, 255 * ratio, 255 * .5];
    for (let channel = 0; channel < 4; channel++) {
      assert(Math.abs(pixel.rgba[channel] - expected[channel]) <= evidence.channelTolerance,
        `${label}: (${pixel.x}, ${pixel.y}) channel ${channel}: ${pixel.rgba[channel]} != ${expected[channel]}`);
    }
  }
  return row;
}

async function mutations() {
  const row = await gate.page.evaluate(() => {
    const fixture = window.__a18Gradient;
    const before = fixture.app.host.elements.get(fixture.button.$node.id).style.backgroundImage;
    fixture.stop.Color = fixture.app.Windows.UI.Color.FromArgb(255, 0, 255, 0);
    fixture.app.flush();
    const after = fixture.app.host.elements.get(fixture.button.$node.id).style.backgroundImage;
    const shape = fixture.host.elements.get('shape');
    const text = fixture.host.elements.get('text');
    return {before, after, model: fixture.app.host.nodes.get(fixture.button.$node.id).properties.Background,
      fallback: shape.dataset.renderFallback, shapeImage: shape.style.backgroundImage,
      solidPrimitives: fixture.host.surfaces.get('canvas').primitives.length,
      foreground: {clip: text.style.backgroundClip, fill: text.style.webkitTextFillColor}, errors: fixture.errors};
  });
  evidence.cases.push({label: 'native paint and JavaScript mutation', ...row});
  await save();
  assert.notEqual(row.before, row.after);
  assert.equal(row.model.GradientStops[0].Color.G, 255);
  assert.equal(row.fallback, 'linear gradient shape uses DOM SVG');
  assert.match(row.shapeImage, /data:image\/svg/);
  assert.equal(row.solidPrimitives, 0);
  assert.equal(row.foreground.fill, 'transparent');
  assert.match(row.foreground.clip, /^text/);
  assert.deepEqual(row.errors, []);
  return row;
}

let failure;
try {
  await install();
  await gate.check('Off-center gradient pixels match the physical-axis oracle on a wide control', () => raster('wide', 240, 80));
  await gate.check('Actual host resize recomputes the physical gradient axis on a tall control', () => raster('tall', 80, 240));
  await gate.check('Live JavaScript brushes, scalar glyphs and gradient shapes retain explicit native paint', mutations);
  await gate.page.screenshot({path: resolve(gate.results, 'screenshots/gradient-native-dom.png')});
  assert.deepEqual(await gate.page.evaluate(() => window.__a18CspViolations), []);
  assert.deepEqual(gate.report.errors, []);
} catch (error) {
  failure = error;
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  try { await save(); }
  finally {
    await gate.close(failure);
  }
}
