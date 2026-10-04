import {resourceContractHelpers} from './resource-contract-helpers.js';
import {registerTemplateContracts} from './template-contracts.js';
import {registerStateContracts} from './state-contracts.js';

/** A15 additions consume the caller's reserved contribution block; released ABI identifiers are untouched. */
export function registerResourceContracts(registry) {
  const {XAML: x, CONTROLS: controls} = registry;
  const {type, method, property, constructor, event, collection} = resourceContractHelpers(registry);
  type(x + 'ResourceDictionary', {kind: 'resourceDictionary'});
  constructor(x + 'ResourceDictionary');
  property(x + 'ResourceDictionary', 'Count', 'int', 0, true);
  for (const [name, parameters, result] of [
    ['Add', ['object', 'object'], 'void'], ['get_Item', ['object'], 'object'], ['set_Item', ['object', 'object'], 'void'],
    ['Remove', ['object'], 'bool'], ['ContainsKey', ['object'], 'bool'], ['Clear', [], 'void']
  ]) method(x + 'ResourceDictionary', name, parameters, result);
  method(x + 'ResourceDictionary', 'TryGetValue', ['object', 'object&'], 'bool', {parameterModes: ['value', 'out']});
  collection(x + 'ResourceDictionaryCollection', x + 'ResourceDictionary');
  type(x + 'ThemeResourceDictionary', {kind: 'themeDictionary'});
  for (const [name, parameters, result] of [
    ['get_Item', ['object'], x + 'ResourceDictionary'], ['set_Item', ['object', x + 'ResourceDictionary'], 'void'],
    ['Add', ['object', x + 'ResourceDictionary'], 'void'], ['Remove', ['object'], 'bool'], ['ContainsKey', ['object'], 'bool']
  ]) method(x + 'ThemeResourceDictionary', name, parameters, result);
  property(x + 'ResourceDictionary', 'MergedDictionaries', x + 'ResourceDictionaryCollection', null, true);
  property(x + 'ResourceDictionary', 'ThemeDictionaries', x + 'ThemeResourceDictionary', null, true);
  property(x + 'FrameworkElement', 'Resources', x + 'ResourceDictionary');
  property(x + 'Application', 'Resources', x + 'ResourceDictionary');
  type(x + 'ApplicationTheme', {kind: 'enum', base: 'System.Enum', values: {Light: 0, Dark: 1}});
  property(x + 'Application', 'RequestedTheme', x + 'ApplicationTheme', 0);
  property(x + 'FrameworkElement', 'ActualTheme', x + 'ElementTheme', 1, true);
  event(x + 'FrameworkElement', 'ActualThemeChanged');
  constructor(x + 'Style', ['System.Type']);
  property(x + 'Style', 'TargetType', 'System.Type');
  property(x + 'Style', 'IsSealed', 'bool', false, true);
  property(x + 'Setter', 'IsSealed', 'bool', false, true);
  type(x + 'TargetPropertyPath', {kind: 'object'});
  constructor(x + 'TargetPropertyPath', ['string']);
  property(x + 'TargetPropertyPath', 'Path', 'string', '');
  property(x + 'Setter', 'Target', x + 'TargetPropertyPath');
  property(controls + 'Control', 'DefaultStyleKey', 'object');
  type(x + 'NameScope', {kind: 'nameScope'});
  constructor(x + 'NameScope');
  method(x + 'NameScope', 'RegisterName', ['string', 'object'], 'void');
  method(x + 'NameScope', 'UnregisterName', ['string'], 'void');
  method(x + 'NameScope', 'FindName', ['string'], 'object');
  method(x + 'NameScope', 'GetNameScope', [x + 'DependencyObject'], x + 'NameScope', {isStatic: true});
  method(x + 'NameScope', 'SetNameScope', [x + 'DependencyObject', x + 'NameScope'], 'void', {isStatic: true});
  registerTemplateContracts(registry);
  registerStateContracts(registry);
  const markup = x + 'Markup.';
  type(markup + 'XamlReader', {kind: 'static'});
  for (const name of ['Load', 'LoadWithInitialTemplateValidation']) method(markup + 'XamlReader', name, ['string'], 'object', {isStatic: true});
  type(markup + 'XamlParseException', {kind: 'object', base: 'System.Exception'});
  property(markup + 'XamlParseException', 'LineNumber', 'int', 0, true);
  property(markup + 'XamlParseException', 'LinePosition', 'int', 0, true);
  type('SharpForge.Xaml.XamlWriter', {kind: 'static'});
  method('SharpForge.Xaml.XamlWriter', 'Save', ['object'], 'string', {isStatic: true});
  type('SharpForge.Xaml.TemplateFactory', {kind: 'delegate', parameters: ['object'], result: x + 'UIElement', base: 'System.MulticastDelegate'});
  constructor('SharpForge.Xaml.TemplateFactory', ['object', 'nint']);
  method('SharpForge.Xaml.TemplateFactory', 'Invoke', ['object'], x + 'UIElement');
  constructor(controls + 'ControlTemplate', ['SharpForge.Xaml.TemplateFactory']);
  constructor(x + 'DataTemplate', ['SharpForge.Xaml.TemplateFactory']);
}
