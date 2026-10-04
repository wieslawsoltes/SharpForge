import {registerBindingContracts} from './property-bindings.js';
import {registerObservableContracts} from './property-observables.js';
import {registerListContracts} from './property-lists.js';

/** Append A15 contracts without redefining any released member or identifier. */
export function registerPropertyContracts(registry) {
  registerMetadataContracts(registry);
  registerObservableContracts(registry);
  registerBindingContracts(registry);
  registerInheritedTextContracts(registry);
  registerAttachedIdentifiers(registry);
  registerListContracts(registry);
}

function registerInheritedTextContracts({types, define, prop, member, memberIndex, XAML, MEDIA}) {
  const textElement = XAML + 'Documents.TextElement';
  if (!types.has(textElement)) define(textElement, {kind: 'abstract', base: XAML + 'DependencyObject'});
  for (const [name, type, value] of [['FontSize', 'double', 14], ['Foreground', MEDIA + 'Brush', null]]) {
    const metadata = {defaultValue: value, inherits: true, inheritanceKey: name};
    const declared = types.get(textElement).properties[name];
    if (declared) { declared.attached = true; declared.metadata = {...declared.metadata, ...metadata}; }
    for (const [prefix, parameters, result, kind] of [
      ['Set', [XAML + 'DependencyObject', type], 'void', 'attachedSet'],
      ['Get', [XAML + 'DependencyObject'], type, 'attachedGet']
    ]) {
      if (!memberIndex.has(textElement + '::' + prefix + name)) {
        member(textElement, prefix + name, parameters, result, {isStatic: true, kind, property: name, metadata});
      }
    }
    const element = types.get(XAML + 'FrameworkElement');
    if (!element.properties[name]) {
      prop(XAML + 'FrameworkElement', name, type, value);
      element.properties[name].metadata = {...metadata, aliasOwner: textElement};
      prop(XAML + 'FrameworkElement', name + 'Property', XAML + 'DependencyProperty', null, true, true);
    }
  }
}

function registerAttachedIdentifiers({contracts, types, prop, XAML}) {
  for (const contract of [...contracts]) {
    if (contract.kind !== 'attachedSet') continue;
    const name = contract.name.slice(3) + 'Property';
    if (!types.get(contract.owner).properties[name]) prop(contract.owner, name, XAML + 'DependencyProperty', null, true, true);
  }
}

function registerMetadataContracts(registry) {
  const {define, ctor, prop, member, delegate, types, XAML} = registry;
  const dependencyObject = XAML + 'DependencyObject';
  const dependencyProperty = XAML + 'DependencyProperty';
  const metadata = XAML + 'PropertyMetadata';
  const changedArgs = XAML + 'DependencyPropertyChangedEventArgs';
  if (!types.has('System.Type')) define('System.Type', {kind: 'abstract', base: 'object'});
  define(changedArgs, {kind: 'object'});
  prop(changedArgs, 'Property', dependencyProperty, null, true);
  prop(changedArgs, 'OldValue', 'object', null, true);
  prop(changedArgs, 'NewValue', 'object', null, true);
  delegate(XAML + 'PropertyChangedCallback', [dependencyObject, changedArgs]);
  delegate(XAML + 'CreateDefaultValueCallback', [], 'object');
  delegate(XAML + 'DependencyPropertyChangedCallback', [dependencyObject, dependencyProperty]);
  define(metadata, {kind: 'propertyMetadata'});
  ctor(metadata, ['object']);
  ctor(metadata, ['object', XAML + 'PropertyChangedCallback']);
  prop(metadata, 'DefaultValue', 'object', null, true);
  prop(metadata, 'PropertyChangedCallback', XAML + 'PropertyChangedCallback', null, true);
  prop(metadata, 'CreateDefaultValueCallback', XAML + 'CreateDefaultValueCallback', null, true);
  member(metadata, 'Create', [XAML + 'CreateDefaultValueCallback'], metadata, {isStatic: true});
  member(metadata, 'Create', [XAML + 'CreateDefaultValueCallback', XAML + 'PropertyChangedCallback'], metadata, {isStatic: true});
  for (const name of ['Register', 'RegisterAttached']) {
    member(dependencyProperty, name, ['string', 'System.Type', 'System.Type', metadata], dependencyProperty, {isStatic: true});
  }
  member(dependencyProperty, 'GetMetadata', ['System.Type'], metadata);
  member(dependencyObject, 'RegisterPropertyChangedCallback', [dependencyProperty, XAML + 'DependencyPropertyChangedCallback'], 'long');
  member(dependencyObject, 'UnregisterPropertyChangedCallback', [dependencyProperty, 'long'], 'void');
  prop(XAML + 'FrameworkElement', 'DataContext', 'object');
  prop(XAML + 'FrameworkElement', 'DataContextProperty', dependencyProperty, null, true, true);
  types.get(XAML + 'FrameworkElement').properties.DataContext.metadata = {inherits: true};
  for (const type of types.values()) {
    for (const name of ['FontSize', 'Foreground', 'FontFamily', 'FontFamilyObject', 'FontWeight', 'FontStyle',
      'RequestedTheme', 'Language', 'FlowDirection']) {
      const property = type.properties[name];
      if (property && !property.isStatic) property.metadata = {...property.metadata, inherits: true, inheritanceKey: name};
    }
  }
  const text = types.get(registry.CONTROLS + 'TextBox')?.properties.Text;
  if (text) text.metadata = {...text.metadata, defaultUpdateSourceTrigger: 'LostFocus'};
}
