import {resourceContractHelpers} from './resource-contract-helpers.js';
import {registerItemEventContracts} from './model-event-contracts.js';

export function registerTemplateContracts(registry) {
  const {XAML: x, CONTROLS: controls} = registry;
  const {type, method, property, constructor, collection} = resourceContractHelpers(registry);
  type(x + 'FrameworkTemplate', {kind: 'template'});
  property(controls + 'ControlTemplate', 'TargetType', 'System.Type');
  method(controls + 'ControlTemplate', 'LoadContent', [], x + 'UIElement');
  type(x + 'DataTemplate', {kind: 'template', base: x + 'FrameworkTemplate'});
  constructor(x + 'DataTemplate');
  method(x + 'DataTemplate', 'LoadContent', [], x + 'UIElement');
  type(controls + 'DataTemplateSelector', {kind: 'object'});
  constructor(controls + 'DataTemplateSelector');
  method(controls + 'DataTemplateSelector', 'SelectTemplate', ['object'], x + 'DataTemplate');
  method(controls + 'DataTemplateSelector', 'SelectTemplate', ['object', x + 'DependencyObject'], x + 'DataTemplate');
  method(controls + 'DataTemplateSelector', 'SelectTemplateCore', ['object', x + 'DependencyObject'], x + 'DataTemplate');
  method(controls + 'DataTemplateSelector', 'SelectTemplateCore', ['object'], x + 'DataTemplate');
  method(controls + 'Control', 'OnApplyTemplate', [], 'void');
  for (const owner of ['ContentControl', 'ContentPresenter']) {
    property(controls + owner, 'ContentTemplate', x + 'DataTemplate');
    property(controls + owner, 'ContentTemplateSelector', controls + 'DataTemplateSelector');
  }
  type(x + 'TemplateBinding', {kind: 'object'});
  constructor(x + 'TemplateBinding');
  property(x + 'TemplateBinding', 'Property', x + 'DependencyProperty');
  type(controls + 'ItemsControl', {kind: 'control', base: controls + 'Control'});
  constructor(controls + 'ItemsControl');
  type(controls + 'ItemsPanelTemplate', {kind: 'template', base: x + 'FrameworkTemplate'});
  constructor(controls + 'ItemsPanelTemplate');
  type(controls + 'StyleSelector', {kind: 'object'});
  constructor(controls + 'StyleSelector');
  method(controls + 'StyleSelector', 'SelectStyle', ['object', x + 'DependencyObject'], x + 'Style');
  method(controls + 'StyleSelector', 'SelectStyleCore', ['object', x + 'DependencyObject'], x + 'Style');
  for (const owner of [controls + 'ItemsControl', controls + 'ListView', controls + 'ComboBox']) {
    property(owner, 'Items', controls + 'ItemCollection', null, true);
    property(owner, 'ItemsSource', 'object');
    property(owner, 'ItemTemplate', x + 'DataTemplate');
    property(owner, 'ItemTemplateSelector', controls + 'DataTemplateSelector');
    property(owner, 'ItemsPanel', controls + 'ItemsPanelTemplate');
    property(owner, 'ItemContainerStyle', x + 'Style');
    property(owner, 'ItemContainerStyleSelector', controls + 'StyleSelector');
    property(owner, 'DisplayMemberPath', 'string', '');
  }
  type(controls + 'ItemContainerGenerator', {kind: 'object'});
  property(controls + 'ItemsControl', 'ItemContainerGenerator', controls + 'ItemContainerGenerator', null, true);
  for (const owner of [controls + 'ItemsControl', controls + 'ItemContainerGenerator']) {
    method(owner, 'ContainerFromItem', ['object'], x + 'DependencyObject');
    method(owner, 'ContainerFromIndex', ['int'], x + 'DependencyObject');
    method(owner, 'ItemFromContainer', [x + 'DependencyObject'], 'object');
    method(owner, 'IndexFromContainer', [x + 'DependencyObject'], 'int');
  }
  method(controls + 'ItemsControl', 'PrepareContainerForItemOverride', [x + 'DependencyObject', 'object'], 'void');
  method(controls + 'ItemsControl', 'ClearContainerForItemOverride', [x + 'DependencyObject', 'object'], 'void');
  method(controls + 'ItemsControl', 'GetContainerForItemOverride', [], x + 'DependencyObject');
  method(controls + 'ItemsControl', 'IsItemItsOwnContainerOverride', ['object'], 'bool');
  const data = x + 'Data.';
  type(data + 'CollectionViewSource', {kind: 'object', base: x + 'DependencyObject'});
  constructor(data + 'CollectionViewSource');
  type(data + 'ICollectionView', {kind: 'object'});
  property(data + 'CollectionViewSource', 'Source', 'object');
  property(data + 'CollectionViewSource', 'IsSourceGrouped', 'bool', false);
  property(data + 'CollectionViewSource', 'ItemsPath', 'string', 'items');
  property(data + 'CollectionViewSource', 'View', data + 'ICollectionView', null, true);
  property(data + 'ICollectionView', 'CurrentItem', 'object', null, true);
  property(data + 'ICollectionView', 'CurrentPosition', 'int', -1, true);
  property(data + 'ICollectionView', 'IsCurrentBeforeFirst', 'bool', true, true);
  property(data + 'ICollectionView', 'IsCurrentAfterLast', 'bool', false, true);
  method(data + 'ICollectionView', 'MoveCurrentTo', ['object'], 'bool');
  method(data + 'ICollectionView', 'MoveCurrentToPosition', ['int'], 'bool');
  for (const name of ['MoveCurrentToFirst', 'MoveCurrentToLast', 'MoveCurrentToNext', 'MoveCurrentToPrevious']) {
    method(data + 'ICollectionView', name, [], 'bool');
  }
  registerItemEventContracts(registry);
  type(controls + 'GroupStyle', {kind: 'object'});
  constructor(controls + 'GroupStyle');
  property(controls + 'GroupStyle', 'HeaderTemplate', x + 'DataTemplate');
  property(controls + 'GroupStyle', 'HeaderTemplateSelector', controls + 'DataTemplateSelector');
  property(controls + 'GroupStyle', 'ContainerStyle', x + 'Style');
  property(controls + 'GroupStyle', 'HeaderContainerStyle', x + 'Style');
  property(controls + 'GroupStyle', 'HidesIfEmpty', 'bool', false);
  collection(controls + 'GroupStyleCollection', controls + 'GroupStyle');
  property(controls + 'ItemsControl', 'GroupStyle', controls + 'GroupStyleCollection', null, true);
  type(controls + 'GroupItem', {kind: 'control', base: controls + 'ContentControl'});
  constructor(controls + 'GroupItem');
}
