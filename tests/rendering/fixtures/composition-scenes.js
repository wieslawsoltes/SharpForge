import {Compositor, encodeCompositionLayers} from '@sharpforge/rendering';

function gradient(compositor, radial = false) {
  const brush = compositor[radial ? 'CreateRadialGradientBrush' : 'CreateLinearGradientBrush']();
  brush.ColorStops.Add(compositor.CreateColorGradientStop(0, [1, 0.2, 0.1, 1]));
  brush.ColorStops.Add(compositor.CreateColorGradientStop(1, [0.1, 0.4, 1, radial ? 0 : 1]));
  return brush;
}

/** Exercises composition brush descriptors and retained shape trim through the compositor's real content bridge. */
export function compositionScene(context, definition, resources) {
  const compositor = new Compositor({resources});
  const root = compositor.CreateContainerVisual();
  root.Size = [definition.width, definition.height];
  if (definition.scene === 'composition-trim') {
    const visual = compositor.CreateShapeVisual();
    visual.Size = root.Size;
    const geometry = compositor.CreateRoundedRectangleGeometry();
    geometry.Offset = [12, 12];
    geometry.Size = [100, 68];
    geometry.CornerRadius = [12, 12];
    geometry.TrimStart = 0.1;
    geometry.TrimEnd = 0.8;
    geometry.TrimOffset = 0.05;
    const shape = compositor.CreateSpriteShape(geometry);
    shape.StrokeBrush = gradient(compositor);
    shape.StrokeThickness = 5;
    shape.StrokeDashArray.ReplaceAll([0, 2, 2, 1]);
    shape.StrokeDashCap = 2;
    visual.Shapes.Add(shape);
    root.Children.InsertAtTop(visual);
  } else {
    const linear = gradient(compositor), radial = gradient(compositor, true);
    const image = compositor.CreateSurfaceBrush({width: 2, height: 2, alphaMode: 'straight', colorSpace: 'srgb',
      pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255])});
    const nine = compositor.CreateNineGridBrush();
    nine.Source = image;
    nine.LeftInset = nine.TopInset = nine.RightInset = nine.BottomInset = 0.5;
    const mask = compositor.CreateMaskBrush();
    mask.Source = linear;
    mask.Mask = radial;
    const factory = compositor.CreateEffectFactory({type: 'Saturation', saturation: 0.2, sources: [{type: 'Source', name: 'Source'}]});
    const effect = factory.CreateBrush();
    effect.SetSourceParameter('Source', linear);
    const brushes = [compositor.CreateColorBrush([0.2, 0.5, 0.9, 1]), linear, radial, image, nine, mask,
      compositor.CreateBackdropBrush(), effect];
    context.DrawRectangle([0, 0, definition.width, definition.height], '#ffe8c0');
    context.DrawRectangle([0, 45, definition.width, 20], '#30b060');
    for (const [index, brush] of brushes.entries()) {
      const visual = compositor.CreateSpriteVisual();
      visual.Size = [32, 32];
      visual.Offset = [4 + index % 3 * 42, 4 + Math.floor(index / 3) * 42, 0];
      visual.Brush = brush;
      root.Children.InsertAtTop(visual);
    }
    factory.dispose();
  }
  compositor.attach(root);
  context.DrawLayer({displayList: encodeCompositionLayers(compositor.layers())});
  return () => compositor.dispose();
}

export function effectGraph(type) {
  const source = {type: 'Source', name: 'Source'};
  const color = {type: 'ColorSource', color: [0.1, 0.8, 0.3, 0.8]};
  const graphs = {
    GaussianBlur: {type, blurAmount: 4, sources: [source]}, Saturation: {type, saturation: 0, sources: [source]},
    Opacity: {type, opacity: 0.4, sources: [source]}, Tint: {type, color: [0.4, 0.8, 1, 1], sources: [source]},
    ColorSource: color, Blend: {type, mode: 'Multiply', sources: [source, color]},
    ArithmeticComposite: {type, coefficients: [0, 0.5, 0.5, 0], sources: [source, color]}
  };
  if (!graphs[type]) throw new TypeError('Unsupported effect fixture');
  return graphs[type];
}
