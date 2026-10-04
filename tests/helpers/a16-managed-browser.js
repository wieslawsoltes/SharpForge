/** Real public JavaScript API fixtures complement the raw-scene geometry/gallery fixtures. */
async function installA16ManagedBrowserFixtures() {
  const { createWinUIApp } = await __sharpforgeTestImport('/packages/winui/src/index.js');
  function begin(width = 580, height = 500) {
    a16.dispose();
    const column = document.createElement('div'), root = document.createElement('div'), before = document.createElement('button');
    before.textContent = 'Before main'; before.dataset.a16Before = 'main';
    root.dataset.a16Root = 'main';
    Object.assign(root.style, { position: 'relative', width: width + 'px', height: height + 'px', overflow: 'hidden' });
    column.append(before, root); a16.stage.append(column);
    const app = createWinUIApp(root, { backend: 'dom', onError: error => a16.errors.push({ message: String(error.message ?? error) }) });
    const X = app.Microsoft.UI.Xaml, C = X.Controls;
    const panel = new C.StackPanel(), window = new X.Window();
    panel.Spacing = 12; window.Content = panel;
    const record = { app, host: app.host, services: app.host.services, root, before, X, C, panel, window,
      events: [], privateEdits: [], stateChanges: [] };
    a16.records.set('main', record);
    return record;
  }
  const identity = value => value?.$node?.id ?? value?.$ref ?? value?.id ?? value;
  function items(collection) {
    return Array.from({ length: collection.Count }, (_, index) => collection.get_Item(index));
  }
  function states(record, button) {
    const root = button.GetTemplateChild('LayoutRoot');
    if (!root) throw new Error('Default button template root was not materialized');
    return Object.fromEntries(items(record.X.VisualStateManager.GetVisualStateGroups(root)).map(group => [group.Name, group.CurrentState?.Name]));
  }
  async function templates() {
    const record = begin(), { X, C, panel, window, app } = record;
    const route = new C.Button(), stateButton = new C.Button();
    route.Content = 'Templated route'; route.Width = 260; route.Height = 76;
    const template = new C.ControlTemplate(), border = new C.Border(), presenter = new C.ContentPresenter();
    border.Name = 'InnerBorder'; border.Padding = new X.Thickness(12); border.Child = presenter;
    presenter.Name = 'PART_BehaviorRoot'; presenter.Content = 'Templated route';
    template.TargetTypeName = 'Button'; template.VisualTree = border; route.Template = template;
    stateButton.Content = 'Native state'; stateButton.Width = 260; stateButton.Height = 48;
    route.Click.add((sender, args) => record.events.push({ name: 'Click', sender: identity(sender), original: identity(args.OriginalSource) }));
    stateButton.PointerPressed.add((sender, args) => {
      record.events.push({ name: 'PointerPressed', pressed: stateButton.IsPressed, state: states(record, stateButton).CommonStates });
      if (record.captureNext) record.events.push({ name: 'CaptureResult', value: stateButton.CapturePointer(args.Pointer) });
    });
    stateButton.PointerMoved.add((sender, args) => {
      if (record.captureNext) record.events.push({ name: 'CapturedMove', point: args.GetCurrentPoint(stateButton).Position });
    });
    stateButton.PointerCaptureLost.add(() => record.events.push({ name: 'CaptureLost' }));
    panel.Children.Add(route); panel.Children.Add(stateButton); window.Activate();
    await app.settled();
    Object.assign(record, { route, stateButton });
    return { route: identity(route), border: identity(route.GetTemplateChild('InnerBorder')), stateButton: identity(stateButton) };
  }
  function templateState() {
    const record = a16.records.get('main');
    return { events: record.events, states: states(record, record.stateButton), pointerOver: record.stateButton.IsPointerOver,
      pressed: record.stateButton.IsPressed, focusState: record.stateButton.FocusState };
  }
  async function scrolling() {
    const record = begin(), { X, C, panel, window, app } = record;
    panel.Orientation = C.Orientation.Horizontal;
    const scroll = new C.ScrollView(), body = new C.Border(), label = new C.TextBlock(), bar = new C.AnnotatedScrollBar();
    scroll.Width = 220; scroll.Height = 180; scroll.ZoomMode = C.ZoomMode.Enabled;
    scroll.ContentOrientation = C.ScrollingContentOrientation.Both;
    body.Width = 400; body.Height = 1000; label.Text = 'Wheel and pinch this content'; body.Child = label; scroll.Content = body;
    bar.Width = 180; bar.Height = 180;
    for (const [name, offset] of [['A', 0], ['B', 250], ['C', 500], ['D', 820]]) bar.Labels.Add(new C.AnnotatedScrollBarLabel(name, offset));
    bar.LabelTemplate = new X.DataTemplate(() => { const text = new C.TextBlock(); text.Text = 'Managed label'; return text; });
    bar.DetailLabelTemplate = new X.DataTemplate(() => {
      const text = new C.TextBlock(); text.Text = 'Managed detail'; text.TextWrapping = X.TextWrapping.Wrap; return text;
    });
    record.cancelAnnotated = false;
    bar.Scrolling.add((sender, args) => { args.Cancel = record.cancelAnnotated; record.events.push({ name: 'Scrolling',
      offset: args.ScrollOffset, kind: args.ScrollingEventKind, cancel: args.Cancel }); });
    bar.DetailLabelRequested.add((sender, args) => { args.Content = 'Offset ' + Math.round(args.ScrollOffset); });
    scroll.ViewChanged.add((sender, args) => record.events.push({ name: 'ViewChanged', intermediate: args.IsIntermediate,
      offset: scroll.VerticalOffset, zoom: scroll.ZoomFactor }));
    scroll.ScrollCompleted.add((sender, args) => record.events.push({ name: 'ScrollCompleted', id: args.CorrelationId,
      offset: scroll.VerticalOffset }));
    panel.Children.Add(scroll); panel.Children.Add(bar); window.Activate();
    await app.settled();
    const presenter = scroll.ScrollPresenter;
    if (!presenter) throw new Error('ScrollView.ScrollPresenter must be the actual template part');
    presenter.VerticalScrollController = bar.ScrollController;
    await app.settled();
    Object.assign(record, { scroll, body, label, bar, presenter });
    return { scroll: identity(scroll), body: identity(body), label: identity(label), bar: identity(bar), presenter: identity(presenter) };
  }
  function scrollState() {
    const record = a16.records.get('main'), { scroll, bar, host } = record;
    return { offset: scroll.VerticalOffset, zoom: scroll.ZoomFactor, extent: scroll.ExtentHeight, viewport: scroll.ViewportHeight,
      controller: { canScroll: bar.ScrollController.CanScroll, value: bar.Value, maximum: bar.Maximum },
      events: record.events, errors: a16.errors, world: host.getLayout(identity(record.body)).bounds,
      templates: host.nodes.get(identity(bar)).properties.$layoutTemplates };
  }
  async function expander() {
    const record = begin(), { X, C, panel, window, app } = record;
    const expander = new C.Expander();
    expander.Width = 300; expander.Header = 'Header data'; expander.Content = 'Content data';
    expander.HeaderTemplate = new X.DataTemplate(() => { const text = new C.TextBlock(); text.Text = 'Templated header'; return text; });
    expander.ContentTemplate = new X.DataTemplate(() => { const text = new C.TextBlock(); text.Text = 'Templated body'; text.Height = 70; return text; });
    expander.Expanding.add(() => record.events.push({ name: 'Expanding' }));
    expander.Collapsed.add(() => record.events.push({ name: 'Collapsed' }));
    panel.Children.Add(expander); window.Activate(); await app.settled();
    record.expander = expander;
    return { id: identity(expander), header: identity(expander.GetTemplateChild('HeaderPresenter')),
      content: identity(expander.GetTemplateChild('PART_BehaviorRoot')) };
  }
  function expanderState() {
    const { expander, host, events } = a16.records.get('main');
    const root = host.elements.get(identity(expander));
    return { expanded: expander.IsExpanded, text: root.textContent, height: expander.ActualHeight,
      header: host.getLayout(identity(expander.GetTemplateChild('HeaderPresenter'))).bounds,
      content: host.getLayout(identity(expander.GetTemplateChild('PART_BehaviorRoot'))).bounds,
      ariaExpanded: root.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'), events };
  }
  async function responsive(width = 300, height = 500) {
    const record = begin(width, height), { X, C, panel, window, app } = record;
    const button = new C.Button(), text = new C.TextBlock();
    button.Content = 'Readable button'; text.Text = 'Text scales independently of physical pixels.';
    text.TextWrapping = X.TextWrapping.Wrap;
    button.Click.add(() => record.events.push({ name: 'Click' }));
    panel.Children.Add(button); panel.Children.Add(text); window.Activate(); await app.settled();
    Object.assign(record, { button, text });
    return responsiveState();
  }
  function responsiveState() {
    const { host, button, text } = a16.records.get('main');
    return { environment: host.services.environment.snapshot(), buttonId: identity(button), button: host.getLayout(identity(button)).bounds,
      text: host.getLayout(identity(text)).bounds, buttonFont: getComputedStyle(host.elements.get(identity(button))).fontSize,
      inputPaneCapability: !!navigator.virtualKeyboard, focused: host.focusManager.focusedElement };
  }
  Object.assign(a16, { managedTemplates: templates, managedTemplateState: templateState, managedScrolling: scrolling,
    managedScrollState: scrollState, managedExpander: expander, managedExpanderState: expanderState,
    managedResponsive: responsive, managedResponsiveState: responsiveState });
}
