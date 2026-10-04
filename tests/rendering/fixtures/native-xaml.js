import {beginPublicHost} from './public-host.js';

async function exactXaml(definition) {
  if (!/^[a-z][a-z0-9-]{0,63}\.xaml$/.test(definition.file)
    || !/^[a-f0-9]{64}$/.test(definition.xamlSha256)) throw new Error('Invalid native fixture identity');
  const response = await fetch('/tests/rendering/native/fixtures/' + definition.file, {cache: 'no-store'});
  if (!response.ok) throw new Error('Shared native XAML input is unavailable: ' + response.status);
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.length || data.length > 256 * 1024) throw new Error('Shared native XAML input exceeds its byte budget');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const sha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
  if (sha256 !== definition.xamlSha256) throw new Error('Browser XAML bytes do not match the native fixture hash');
  return {text: new TextDecoder('utf-8', {fatal: true}).decode(data), sha256};
}

async function requireLocalFonts(document, names, loaded) {
  if (!Array.isArray(names) || names.length > 16 || names.some(name => name !== 'Segoe UI')) {
    throw new Error('Native fixture declares an unsupported local-font prerequisite');
  }
  for (const family of names) {
    // FontFace local() rejects when the installed font is unavailable; fonts.check alone can accept fallback.
    const font = new document.defaultView.FontFace(family, `local("${family}")`);
    try { await font.load(); }
    catch (cause) { throw new Error('SF_RENDER_NATIVE_FONT_UNAVAILABLE: install the native fixture font ' + family, {cause}); }
    document.fonts.add(font);
    loaded.push(font);
  }
}

function shapeDefaults(app) {
  const X = app.Microsoft.UI.Xaml;
  const thickness = X.Shapes.Shape.StrokeThicknessProperty;
  const stretch = X.Shapes.Shape.StretchProperty;
  return ['Rectangle', 'Ellipse', 'Line', 'Path', 'Polygon', 'Polyline'].map(name => {
    const shape = new X.Shapes[name]();
    const names = Object.entries(X.Media.Stretch);
    const stretchName = value => names.find(([, number]) => number === value)?.[0] ?? 'Unavailable';
    return {type: 'Microsoft.UI.Xaml.Shapes.' + name,
      strokeThickness: shape.StrokeThickness, strokeViaGetValue: shape.GetValue(thickness),
      stretch: stretchName(shape.Stretch), stretchViaGetValue: stretchName(shape.GetValue(stretch)),
      strokeHasLocalValue: shape.ReadLocalValue(thickness) !== X.DependencyProperty.UnsetValue,
      stretchHasLocalValue: shape.ReadLocalValue(stretch) !== X.DependencyProperty.UnsetValue};
  });
}

/** Load the exact native producer input through the public XAML reader and capture the actual transparent browser compositor. */
export async function createNativeXamlFixture(definition, options) {
  const input = await exactXaml(definition);
  const fonts = [];
  let session;
  try {
    await requireLocalFonts(options.document, definition.requiredFonts ?? [], fonts);
    session = beginPublicHost(definition, options);
    const {app, host} = session;
    const X = app.Microsoft.UI.Xaml;
    const content = X.Markup.XamlReader.Load(input.text);
    content.RequestedTheme = X.ElementTheme[definition.theme];
    const window = new X.Window();
    window.Content = content;
    window.Activate();
    await session.settle();
    if (definition.focusTarget) {
      const target = content.FindName(definition.focusTarget);
      if (!target || target.Focus(X.FocusState.Keyboard) !== true) throw new Error('Native fixture keyboard focus target is unavailable');
      await session.settle();
      await new Promise(resolve => options.document.defaultView.requestAnimationFrame(resolve));
      session.renderFrame();
    }
    return {...session,
      verify() {
        const scale = options.document.defaultView.devicePixelRatio;
        if (Math.abs(scale - definition.dpr) > 0.001) throw new Error('Native/browser fixture DPR differs');
        return {passed: true, referenceKind: 'same-xaml-native-winui', xamlSha256: input.sha256,
          input: {id: definition.id, width: definition.width, height: definition.height, dpr: definition.dpr,
            theme: definition.theme, focusTarget: definition.focusTarget ?? null},
          fonts: fonts.map(font => ({family: font.family, status: font.status, source: 'installed-local-font'})),
          fontByteIdentity: 'Browser local fonts do not expose file hashes; native installed-font hashes remain in provider provenance',
          shapeDefaults: shapeDefaults(app),
          environment: {highContrast: !!host.services.environment.HighContrast,
            textScaleFactor: host.services.environment.TextScaleFactor, actualTheme: definition.theme},
          transparency: 'Actual browser screenshot with page background omitted'};
      },
      dispose() {
        session.dispose();
        for (const font of fonts) options.document.fonts.delete(font);
      }};
  } catch (error) {
    session?.dispose();
    for (const font of fonts) options.document.fonts.delete(font);
    throw error;
  }
}
