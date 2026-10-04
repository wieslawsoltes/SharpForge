const C = 'Microsoft.UI.Xaml.Controls.', X = 'Microsoft.UI.Xaml.', S = 'Microsoft.UI.Xaml.Shapes.';
const ref = $ref => ({ $ref });
const node = (id, type, properties = {}, children = []) => ({ id,
  type: type.includes('.') ? type : C + type, properties, collections: { Children: children.map(ref) }, events: [] });
const scene = (nodes, content = nodes[0].id) => ({ version: 1, windows: ['window'],
  nodes: [node('window', X + 'Window', { Content: ref(content) }), ...nodes] });

export function alignmentScene(horizontal = false) {
  const children = ['start', 'center', 'end', 'stretch'];
  return scene([node('panel', 'StackPanel', { Width: 240, Height: 200, Orientation: horizontal ? 'Horizontal' : 'Vertical' }, children),
    ...children.map((id, index) => node(id, 'Border', horizontal
      ? { Width: 30, Height: index === 3 ? undefined : 40, VerticalAlignment: index, Background: '#406080' }
      : { Width: index === 3 ? undefined : 40, Height: 30, HorizontalAlignment: index, Background: '#406080' }))]);
}
export function buttonAlignmentScene({ type = 'Button', height = 32, fontSize = 14, content = 'string' } = {}) {
  const button = node('button', type, { Width: 240, Height: height, FontSize: fontSize, Content: 'Hg',
    HorizontalContentAlignment: 1, VerticalContentAlignment: 1, 'AutomationProperties.Name': 'Alignment sample' });
  const nodes = [button];
  button.events.push('Click');
  if (content === 'element') {
    button.properties.Content = ref('text');
    nodes.push(node('text', 'TextBlock', { Text: 'Hg', FontSize: fontSize, HorizontalAlignment: 1, VerticalAlignment: 1 }));
  }
  if (content === 'template') {
    button.templateRoot = 'template';
    nodes.push({ ...node('template', 'Border', { Name: 'RootBorder', Child: ref('presenter') }), templateOwner: 'button' });
    nodes.push({ ...node('presenter', 'ContentPresenter', { Name: 'PART_BehaviorRoot',
      HorizontalContentAlignment: 1, VerticalContentAlignment: 1 }), templateOwner: 'button' });
  }
  return scene(nodes);
}
export function borderScene() {
  return scene([node('panel', 'StackPanel', { Width: 320, Height: 120, Spacing: 8 }, ['default', 'explicit']),
    ...['default', 'explicit'].map(id => node(id, 'Button', { Content: 'Border', Width: 200, Height: 40,
      BorderThickness: { Left: 1, Top: 1, Right: 1, Bottom: 1 }, ...(id === 'explicit' ? { BorderBrush: '#ff102030' } : {}) }))]);
}
export function shapeScene(parent = 'StackPanel') {
  return scene([node('panel', parent, { Width: 240, Height: 180, Orientation: 'Vertical' }, ['one', 'two']),
    node('one', S + 'Rectangle', { Width: 40, Height: 30, Fill: '#ff206080', $Left: 70, $Top: 80,
      HorizontalAlignment: parent === 'Grid' ? 1 : 0, VerticalAlignment: parent === 'Grid' ? 2 : 0 }),
    node('two', S + 'Ellipse', { Width: 50, Height: 20, Fill: '#ff804020', HorizontalAlignment: 0, VerticalAlignment: 0 })]);
}
export function radioScene(prefix = 'radio', named = false) {
  const ids = ['a', 'b', 'c', 'd'].map(name => prefix + ':' + name);
  const nodes = [node(prefix + ':panel', 'StackPanel', { Width: 280, Height: 220 }, [prefix + ':p1', prefix + ':p2']),
    node(prefix + ':p1', 'StackPanel', { Height: 100 }, ids.slice(0, 2)),
    node(prefix + ':p2', 'StackPanel', { Height: 100 }, ids.slice(2)),
    ...ids.map(id => node(id, 'RadioButton', { Content: id, GroupName: named ? 'shared' : '', Height: 40 }))];
  return scene(nodes);
}
export function dragScene() {
  return scene([node('panel', 'StackPanel', { Width: 320, Height: 220, Spacing: 20 }, ['source', 'target']),
    node('source', 'TextBlock', { Width: 280, Height: 60, Text: 'Drag this text', CanDrag: true, Background: '#304060' }),
    node('target', 'Border', { Width: 280, Height: 80, AllowDrop: true, Background: '#204020', Child: ref('target-text') }),
    node('target-text', 'TextBlock', { Text: 'Drop target', Width: 220, Height: 40 })]);
}

export function richOverflowScene() {
  const text = Array.from({ length: 90 }, (_, index) => 'Word' + index).join(' ');
  const first = node('rich', 'RichTextBlock', { Width: 150, Height: 90, FontSize: 14, OverflowContentTarget: ref('overflow1') });
  first.collections.Blocks = [ref('paragraph')];
  const paragraph = node('paragraph', 'Microsoft.UI.Xaml.Documents.Paragraph');
  paragraph.collections.Inlines = [ref('run')];
  return { text, scene: scene([node('panel', 'StackPanel', { Width: 480, Height: 120, Orientation: 'Horizontal' },
    ['rich', 'overflow1', 'overflow2']), first,
    node('overflow1', 'RichTextBlockOverflow', { Width: 150, Height: 90, OverflowContentTarget: ref('overflow2') }),
    node('overflow2', 'RichTextBlockOverflow', { Width: 150, Height: 90 }), paragraph,
    node('run', 'Microsoft.UI.Xaml.Documents.Run', { Text: text })]) };
}

export function roundedGridScene() {
  const grid = node('round-grid', 'Grid', { Width: 101, Height: 99 }, ['round-a', 'round-b']);
  grid.collections.ColumnDefinitions = [ref('column-a'), ref('column-b')];
  return scene([grid, node('column-a', 'ColumnDefinition', { Width: { valueType: 'Microsoft.UI.Xaml.GridLength', Value: 1, GridUnitType: 2 } }),
    node('column-b', 'ColumnDefinition', { Width: { valueType: 'Microsoft.UI.Xaml.GridLength', Value: 1, GridUnitType: 2 } }),
    node('round-a', 'Border', { Background: '#206080' }), node('round-b', 'Border', { $Column: 1, Background: '#802040' })]);
}
