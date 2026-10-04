import {createWinUIApp} from '@sharpforge/winui';

const contents = new Set(['Button', 'ToggleButton', 'CheckBox', 'RadioButton', 'ContentControl', 'ListViewItem']);
const numeric = new Set(['Slider', 'ProgressBar']);

function explicitTemplate(app, control, definition) {
  const X = app.Microsoft.UI.Xaml, C = X.Controls;
  const template = new C.ControlTemplate();
  template.TargetTypeName = definition.control;
  const border = new C.Border(), text = new C.TextBlock();
  border.Name = 'PART_ConformanceRoot';
  border.Background = new X.Media.SolidColorBrush(app.Microsoft.UI.Colors.Blue);
  border.CornerRadius = new X.CornerRadius(6);
  text.Text = 'Typed template';
  text.Foreground = new X.Media.SolidColorBrush(app.Microsoft.UI.Colors.White);
  border.Child = text;
  template.VisualTree = border;
  control.Template = template;
}

/** Exercises the public JS facade, real templates and native input overlays; screenshots use the actual browser compositor. */
export async function createControlGallery(definition, {document, container, resources, service, backend, onMetrics, onError}) {
  const mount = document.createElement('div');
  Object.assign(mount.style, {position: 'relative', width: definition.width + 'px', height: definition.height + 'px', background: '#ffffff'});
  container.append(mount);
  const measured = new Map();
  const app = createWinUIApp(mount, {backend, animationManual: true, services: {resources, device: service},
    onError, onMetrics: value => { if (value.id) measured.set(value.id, value); onMetrics(value); }});
  try {
    const X = app.Microsoft.UI.Xaml, C = X.Controls;
    const Type = C[definition.control];
    if (typeof Type !== 'function') throw new TypeError('Gallery control is not available: ' + definition.control);
    const control = new Type(), window = new X.Window();
    control.Name = definition.id;
    control.Width = definition.width;
    control.Height = definition.height;
    if (contents.has(definition.control)) control.Content = definition.control;
    if (numeric.has(definition.control)) { control.Minimum = 0; control.Maximum = 100; control.Value = 40; }
    if (definition.control === 'TextBox') control.Text = 'Editing text';
    if (definition.control === 'PasswordBox') control.Password = 'private fixture';
    if (definition.control === 'ComboBox') { control.Items.Add('First'); control.Items.Add('Second'); control.SelectedIndex = 0; }
    if (definition.control === 'ToggleSwitch') control.IsOn = true;
    if (definition.control === 'CheckBox') control.IsChecked = true;
    if (definition.template === 'explicit') explicitTemplate(app, control, definition);
    window.Content = control;
    window.Activate();
    control.ApplyTemplate();
    await app.settled();
    const node = [...app.host.nodes.values()].find(value => value.properties.Name === definition.id);
    if (!control.Template || !node?.templateRoot) {
      throw new Error('SF_RENDER_TEMPLATE_REFERENCE_UNAVAILABLE: gallery needs a materialized control template');
    }
    const surfaces = () => [...app.host.sceneRenderer.entries.values(), ...app.host.sceneRenderer.compositionEntries.values()]
      .map(entry => entry.surface).filter(Boolean);
    await Promise.all(surfaces().map(surface => surface.ready));
    const usedBackends = () => [...new Set([...surfaces().map(surface => surface.backend),
      ...[...measured.values()].filter(value => value.backend === 'dom').map(() => 'dom')])];
    return {width: definition.width, height: definition.height, captureElement: mount,
      gallery: {control: definition.control, template: definition.template ?? 'default', materialized: true, nativeOverlays: true},
      actualBackend: () => usedBackends().includes(backend) ? backend : usedBackends()[0] ?? 'dom', usedBackends,
      renderFrame() { app.host.scheduleRender(); app.flush(); for (const surface of surfaces()) surface.draw(); },
      metrics() {
        const rows = [...measured.values()].filter(value => value.commands !== undefined);
        const sum = key => rows.length && rows.every(row => Number.isFinite(row[key])) ? rows.reduce((total, row) => total + row[key], 0) : null;
        return {drawCalls: sum('drawCalls'), totalGpuBytes: sum('totalGpuBytes'), atlasBytes: sum('atlasBytes'),
          renderTargetBytes: sum('renderTargetBytes'), textureBytes: sum('textureBytes'), bufferBytes: sum('bufferBytes'),
          uploadedBytes: sum('uploadedBytes'), fallbacks: rows.flatMap(row => row.fallbacks ?? []), sampleCount: rows[0]?.sampleCount};
      },
      dispose() { app.dispose(); mount.remove(); }};
  } catch (error) { app.dispose(); throw error; }
}
