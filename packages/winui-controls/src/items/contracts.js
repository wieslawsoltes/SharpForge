export function registerItemsContracts(b) {
  const { X, C } = b;
  b.enumeration(C + 'SelectionMode', { None: 0, Single: 1, Multiple: 2, Extended: 3 });
  b.enumeration(C + 'ListViewSelectionMode', { None: 0, Single: 1, Multiple: 2, Extended: 3 });
  b.enumeration(C + 'ItemsViewSelectionMode', { None: 0, Single: 1, Multiple: 2, Extended: 3 });
  b.enumeration(C + 'TreeViewSelectionMode', { None: 0, Single: 1, Multiple: 2 });
  b.type(C + 'ItemIndexRange', 'object', 'object', [[], ['int', 'uint']]);
  b.props(C + 'ItemIndexRange', { FirstIndex: ['int', 0, true], Length: ['uint', 0, true], LastIndex: ['int', -1, true] });
  b.control('ItemsControl');
  b.control('Primitives.Selector', C + 'ItemsControl');
  b.control('ListViewBase', C + 'Primitives.Selector');
  // These inserted bases retain the released Control ancestry and every existing member ID.
  for (const [name, base] of [['ListView', 'ListViewBase'], ['ComboBox', 'Primitives.Selector']]) {
    const existing = b.registry.types.get(C + name);
    if (existing?.base === C + 'Control') existing.base = C + base;
  }
  for (const name of ['ListView', 'GridView', 'ItemsView', 'ListBox', 'ComboBox', 'FlipView']) {
    const type = b.control(name, C + (['GridView', 'ListView', 'ItemsView'].includes(name) ? 'ListViewBase' : 'Primitives.Selector'));
    b.props(type, { Items: [C + 'ItemCollection', null, true], ItemsSource: 'object', ItemTemplate: 'object',
      ItemTemplateSelector: 'object', ItemContainerStyle: 'object', ItemContainerStyleSelector: 'object',
      DisplayMemberPath: ['string', ''], SelectedValuePath: ['string', ''], SelectedValue: 'object',
      SelectedIndex: ['int', -1], SelectedItem: 'object', SelectedItems: [C + 'ItemCollection', null, true],
      SelectedRanges: ['object[]', null, true], SelectionMode: [C + 'SelectionMode', 1],
      Header: 'object', Footer: 'object', HeaderTemplate: 'object', FooterTemplate: 'object',
      IsItemClickEnabled: ['bool', false], IsItemInvokedEnabled: ['bool', false], CanDragItems: ['bool', false],
      CanReorderItems: ['bool', false], CurrentItemIndex: ['int', -1, true], ItemHeight: ['double', 0], ItemWidth: ['double', 160] });
    b.props(type, { GroupStyle: [C + 'ItemCollection', null, true], GroupKeyPath: ['string', ''],
      AreStickyGroupHeadersEnabled: ['bool', true], GroupAnchor: ['object', null, true] });
    b.event(type, 'GroupAnchorChanged', { GroupAnchor: 'object' });
    b.event(type, 'SelectionChanged', { AddedItems: 'object[]', RemovedItems: 'object[]' });
    b.event(type, 'ItemClick', { ClickedItem: 'object' });
    b.event(type, 'ItemInvoked', { InvokedItem: 'object' });
    b.event(type, 'DragItemsStarting', { Items: 'object[]', Cancel: ['bool', false] });
    b.event(type, 'DragItemsCompleted', { Items: 'object[]', FromIndex: 'int', ToIndex: 'int', CollectionProperty: 'string' });
    for (const name of ['SelectAll', 'DeselectAll']) b.method(type, name);
    b.method(type, 'Select', ['int']);
    b.method(type, 'Deselect', ['int']);
    b.method(type, 'IsSelected', ['int'], 'bool');
    for (const name of ['SelectRange', 'DeselectRange']) b.method(type, name, [C + 'ItemIndexRange']);
    b.method(type, 'ScrollIntoView', ['object']);
    b.method(type, 'ContainerFromIndex', ['int'], X + 'DependencyObject');
    b.method(type, 'ContainerFromItem', ['object'], X + 'DependencyObject');
    b.method(type, 'IndexFromContainer', [X + 'DependencyObject'], 'int');
    b.method(type, 'ItemFromContainer', [X + 'DependencyObject'], 'object');
  }
  for (const name of ['ListViewItem', 'GridViewItem', 'ListBoxItem', 'ComboBoxItem', 'FlipViewItem', 'ItemContainer', 'SelectorBarItem']) {
    b.control(name, C + 'ContentControl', { IsSelected: ['bool', false] });
  }
  b.props(C + 'ComboBox', { IsEditable: ['bool', false], IsDropDownOpen: ['bool', false], Text: ['string', ''],
    MaxDropDownHeight: ['double', 320], PlaceholderText: ['string', ''] });
  b.property(C + 'ItemsView', 'Layout', C + 'Layout');
  b.method(C + 'ItemsView', 'StartBringItemIntoView', ['int']);
  for (const name of ['ListViewBase', 'Primitives.Selector']) b.property(C + name, 'IsSynchronizedWithCurrentItem', 'bool', true);
  b.events(C + 'ComboBox', ['DropDownOpened', 'DropDownClosed']);
  b.event(C + 'ComboBox', 'TextChanged', { Text: 'string' });
  b.event(C + 'ComboBox', 'TextSubmitted', { Text: 'string', Handled: 'bool' });
  b.control('PipsPager', C + 'Control', { NumberOfPages: ['int', 0], SelectedPageIndex: ['int', 0],
    MaxVisiblePips: ['int', 5], Orientation: [C + 'Orientation', 1] }, ['SelectedIndexChanged']);
  b.control('SemanticZoom', C + 'Control', { ZoomedInView: X + 'UIElement', ZoomedOutView: X + 'UIElement',
    IsZoomedInViewActive: ['bool', true], CanChangeViews: ['bool', true], IsZoomOutButtonEnabled: ['bool', true] },
  ['ViewChangeStarted', 'ViewChangeCompleted']);
  b.method(C + 'SemanticZoom', 'ToggleActiveView');
  b.property(C + 'SemanticZoom', 'GroupAnchor', 'object');
  b.event(C + 'SemanticZoom', 'ViewChangeStarted', { IsZoomedInViewActive: 'bool', SourceItem: 'object', Cancel: 'bool' });
  b.event(C + 'SemanticZoom', 'ViewChangeCompleted', { IsZoomedInViewActive: 'bool', DestinationItem: 'object' });
  b.control('GroupStyle', X + 'DependencyObject', { HeaderTemplate: 'object', ContainerStyle: 'object', HidesIfEmpty: ['bool', false] });
  for (const name of ['SelectorBar', 'RadioButtons', 'BreadcrumbBar']) {
    b.control(name, C + 'Control', { Items: [C + 'ItemCollection', null, true], ItemsSource: 'object',
      SelectedIndex: ['int', -1], SelectedItem: 'object', Header: 'object', MaxColumns: ['int', 1] },
    ['SelectionChanged', 'ItemClicked']);
  }
  b.control('TreeView', C + 'Control', { RootNodes: [C + 'ItemCollection', null, true], ItemsSource: 'object',
    SelectedNode: 'object', SelectedNodes: [C + 'ItemCollection', null, true], SelectedItem: 'object',
    SelectedItems: [C + 'ItemCollection', null, true], SelectionMode: [C + 'TreeViewSelectionMode', 1],
    CanDragItems: ['bool', false], CanReorderItems: ['bool', false], ItemTemplate: 'object', ItemHeight: ['double', 0] });
  b.control('TreeViewNode', X + 'DependencyObject', { Content: 'object', Children: [C + 'ItemCollection', null, true],
    Parent: ['object', null, true], Depth: ['int', 0, true], IsExpanded: ['bool', false], HasChildren: ['bool', false, true],
    HasUnrealizedChildren: ['bool', false] });
  b.control('TreeViewItem', C + 'ContentControl', { IsExpanded: ['bool', false], IsSelected: ['bool', false],
    HasUnrealizedChildren: ['bool', false], ItemsSource: 'object' });
  for (const name of ['Expanding', 'Collapsed', 'ItemInvoked', 'SelectionChanged', 'DragItemsStarting', 'DragItemsCompleted']) {
    b.event(C + 'TreeView', name, { Node: C + 'TreeViewNode', Item: 'object', AddedItems: 'object[]', RemovedItems: 'object[]', Cancel: 'bool' });
  }
  b.event(C + 'TreeView', 'ExpansionChanged', { Node: C + 'TreeViewNode', IsExpanded: 'bool' });
  for (const name of ['Expand', 'Collapse']) b.method(C + 'TreeView', name, [C + 'TreeViewNode']);
  b.method(C + 'TreeView', 'SelectAll');
}
