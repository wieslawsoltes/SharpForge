import {beginPublicHost} from './public-host.js';

function premultiplied(bitmap) {
  const data = new Uint8Array(bitmap.pixels);
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.round(data[index + channel] * data[index + 3] / 255);
  }
  return {data, width: bitmap.width, height: bitmap.height, alphaMode: 'premultiplied'};
}

/** Exercise both public capture APIs against the actual on-screen retained subtree at the same physical dimensions. */
export async function createBitmapCaptureFixture(definition, options) {
  const session = beginPublicHost(definition, options);
  try {
    const {app, host} = session;
    const X = app.Microsoft.UI.Xaml;
    const panel = new X.Controls.Canvas();
    panel.Width = definition.width;
    panel.Height = definition.height;
    panel.Name = 'BitmapCaptureRoot';
    for (const item of [{x: 8, y: 8, width: 96, height: 64, color: app.Microsoft.UI.Colors.Red, opacity: 0.5},
      {x: 56, y: 40, width: 104, height: 64, color: app.Microsoft.UI.Colors.Blue, opacity: 0.75}]) {
      const shape = new X.Shapes.Rectangle();
      shape.Width = item.width;
      shape.Height = item.height;
      shape.Fill = new X.Media.SolidColorBrush(item.color);
      shape.Opacity = item.opacity;
      X.Controls.Canvas.SetLeft(shape, item.x);
      X.Controls.Canvas.SetTop(shape, item.y);
      panel.Children.Add(shape);
    }
    const window = new X.Window();
    window.Content = panel;
    window.Activate();
    await session.settle();
    const node = [...host.nodes.values()].find(value => value.properties.Name === panel.Name);
    const width = Math.ceil(definition.width * (definition.dpr ?? 1));
    const height = Math.ceil(definition.height * (definition.dpr ?? 1));
    const direct = await host.renderToBitmap(node.id, {width, height});
    const managed = new X.Media.Imaging.RenderTargetBitmap();
    await managed.RenderAsync(panel, width, height);
    const bytes = new Uint8Array(await managed.GetPixelsAsync());
    if (managed.PixelWidth !== width || managed.PixelHeight !== height || bytes.length !== direct.pixels.length
      || bytes.some((value, index) => value !== direct.pixels[index])) {
      throw new Error('RenderTargetBitmap.RenderAsync differs from the public retained host capture');
    }
    let invalidDimensions;
    try { await managed.RenderAsync(panel, 0, 0); }
    catch (error) { invalidDimensions = error.code; }
    if (invalidDimensions !== 'SFRENDER065') throw new Error('Invalid RenderAsync dimensions require SFRENDER065');
    return {...session,
      verify: () => ({passed: true, width, height, directBytes: direct.pixels.length, managedBytes: bytes.length,
        managedPixelWidth: managed.PixelWidth, managedPixelHeight: managed.PixelHeight,
        invalidDimensionDiagnostic: invalidDimensions, apiAgreement: 'byte-exact',
        screenAgreement: 'Required separately by the captured browser-compositor pixel comparison'}),
      reference: () => ({kind: 'canvas2d-host-bitmap', provider: 'public-host-renderToBitmap', glyphAccess: 'not-applicable',
        sharedRendererCode: true, input: 'actual-public-host-subtree', ...premultiplied(direct)})};
  } catch (error) {
    session.dispose();
    throw error;
  }
}
