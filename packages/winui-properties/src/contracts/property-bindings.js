import {BindingMode, UpdateSourceTrigger, RelativeSourceMode} from '../binding/binding.js';

/** Standard WinUI Binding contracts. Runtime behavior is supplied through the A15 adapter. */
export function registerBindingContracts(registry) {
  const {define, ctor, prop, member, en, XAML} = registry;
  const data = XAML + 'Data.';
  en(data + 'BindingMode', BindingMode);
  en(data + 'UpdateSourceTrigger', UpdateSourceTrigger);
  en(data + 'RelativeSourceMode', RelativeSourceMode);
  define(XAML + 'PropertyPath', {kind: 'propertyPath'});
  ctor(XAML + 'PropertyPath', ['string']);
  prop(XAML + 'PropertyPath', 'Path', 'string', '', true);
  define(data + 'IValueConverter', {kind: 'interface'});
  member(data + 'IValueConverter', 'Convert', ['object', 'System.Type', 'object', 'string'], 'object');
  member(data + 'IValueConverter', 'ConvertBack', ['object', 'System.Type', 'object', 'string'], 'object');
  define(data + 'RelativeSource', {kind: 'relativeSource', base: XAML + 'DependencyObject'});
  ctor(data + 'RelativeSource');
  prop(data + 'RelativeSource', 'Mode', data + 'RelativeSourceMode', 1);
  define(data + 'BindingBase', {kind: 'abstract', base: XAML + 'DependencyObject'});
  define(data + 'Binding', {kind: 'binding', base: data + 'BindingBase'});
  ctor(data + 'Binding');
  const properties = [
    ['Path', XAML + 'PropertyPath', null], ['Source', 'object', null], ['ElementName', 'string', null],
    ['RelativeSource', data + 'RelativeSource', null], ['Mode', data + 'BindingMode', BindingMode.OneWay],
    ['Converter', data + 'IValueConverter', null], ['ConverterParameter', 'object', null],
    ['ConverterLanguage', 'string', ''], ['FallbackValue', 'object', null], ['TargetNullValue', 'object', null],
    ['UpdateSourceTrigger', data + 'UpdateSourceTrigger', 0]
  ];
  for (const [name, type, value] of properties) prop(data + 'Binding', name, type, value);
  define(data + 'BindingExpression', {kind: 'bindingExpression'});
  prop(data + 'BindingExpression', 'ParentBinding', data + 'Binding', null, true);
  prop(data + 'BindingExpression', 'DataItem', 'object', null, true);
  member(data + 'BindingExpression', 'UpdateSource', [], 'void');
  define(data + 'BindingOperations', {kind: 'static'});
  member(data + 'BindingOperations', 'SetBinding', [XAML + 'DependencyObject', XAML + 'DependencyProperty', data + 'BindingBase'], 'void', {
    isStatic: true
  });
  member(XAML + 'FrameworkElement', 'SetBinding', [XAML + 'DependencyProperty', data + 'BindingBase'], 'void');
  member(XAML + 'FrameworkElement', 'GetBindingExpression', [XAML + 'DependencyProperty'], data + 'BindingExpression');
}
