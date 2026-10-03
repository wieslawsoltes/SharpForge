export const colorValues = Object.freeze({Transparent:'#00000000',Black:'#000000',White:'#ffffff',Red:'#ff0000',Green:'#008000',Blue:'#0000ff',Orange:'#ffa500',Gray:'#808080',LightGray:'#d3d3d3',DarkGray:'#a9a9a9',Purple:'#800080',Yellow:'#ffff00',CornflowerBlue:'#6495ed',DodgerBlue:'#1e90ff'});
export function registerCoreXaml({define,member,ctor,prop,event,en,control,delegate,types,aliases,XAML,CONTROLS,MEDIA,TASK,THREAD}) {
// WinUI names and common code-first contracts. Windows-only services remain explicitly unsupported.
en(XAML + 'Orientation', {Vertical: 0, Horizontal: 1});
// Orientation lives in Controls in the public WinUI API.
const orientation = types.get(XAML + 'Orientation');types.delete(orientation.name);orientation.name=CONTROLS+'Orientation';types.set(orientation.name,orientation);aliases.set('Orientation',orientation.name);aliases.set(XAML+'Orientation',orientation.name);aliases.set(orientation.name,orientation.name);
en(XAML + 'HorizontalAlignment', {Left: 0, Center: 1, Right: 2, Stretch: 3});
en(XAML + 'VerticalAlignment', {Top: 0, Center: 1, Bottom: 2, Stretch: 3});
en(XAML + 'Visibility', {Visible: 0, Collapsed: 1});
en(XAML + 'ElementTheme', {Default: 0, Light: 1, Dark: 2});
en(XAML + 'GridUnitType', {Auto: 0, Pixel: 1, Star: 2});
en(XAML + 'TextWrapping', {NoWrap: 0, Wrap: 1, WrapWholeWords: 2});
en(XAML + 'TextAlignment', {Left: 0, Center: 1, Right: 2, Justify: 3, DetectFromContent: 4});
en(CONTROLS + 'ScrollBarVisibility', {Disabled: 0, Auto: 1, Hidden: 2, Visible: 3});
for (const [name, props, constructors] of [
  [XAML + 'Thickness', ['Left','Top','Right','Bottom'], [['double'],['double','double','double','double']]],
  [XAML + 'CornerRadius', ['TopLeft','TopRight','BottomRight','BottomLeft'], [['double'],['double','double','double','double']]],
  [XAML + 'GridLength', ['Value'], [['double'], ['double', XAML + 'GridUnitType']]],
  ['Windows.UI.Color', ['A','R','G','B'], []]
]) {
  define(name, {kind: 'value', slots: props, base: 'System.ValueType'});
  for (const args of constructors) ctor(name, args);
  for (const p of props) prop(name, p, name==='Windows.UI.Color'?'int':'double', 0, true);
}
prop(XAML+'GridLength','GridUnitType',XAML+'GridUnitType',1,true);
prop(XAML+'GridLength','Auto',XAML+'GridLength',null,true,true);
member('Windows.UI.Color','FromArgb',['int','int','int','int'],'Windows.UI.Color',{isStatic:true});
define('Microsoft.UI.Colors',{kind:'static'});

for(const [name,value] of Object.entries(colorValues))prop('Microsoft.UI.Colors',name,'Windows.UI.Color',value,true,true);
define(MEDIA+'Brush',{kind:'abstract'});prop(MEDIA+'Brush','Opacity','double',1);
define(MEDIA+'SolidColorBrush',{base:MEDIA+'Brush',kind:'brush'});ctor(MEDIA+'SolidColorBrush');ctor(MEDIA+'SolidColorBrush',['Windows.UI.Color']);prop(MEDIA+'SolidColorBrush','Color','Windows.UI.Color');
define(XAML+'DependencyObject',{kind:'object'});
define(XAML+'UIElement',{base:XAML+'DependencyObject',kind:'abstract'});
for(const [n,t,v]of [['Visibility',XAML+'Visibility',0],['Opacity','double',1],['IsHitTestVisible','bool',true]])prop(XAML+'UIElement',n,t,v);
define(XAML+'FrameworkElement',{base:XAML+'UIElement',kind:'abstract'});
for(const [n,t,v]of [['Name','string',''],['Width','double',NaN],['Height','double',NaN],['MinWidth','double',0],['MinHeight','double',0],['MaxWidth','double',Infinity],['MaxHeight','double',Infinity],['Margin',XAML+'Thickness',null],['HorizontalAlignment',XAML+'HorizontalAlignment',3],['VerticalAlignment',XAML+'VerticalAlignment',3],['RequestedTheme',XAML+'ElementTheme',0],['Tag','object',null]])prop(XAML+'FrameworkElement',n,t,v);
for(const p of ['ActualWidth','ActualHeight'])prop(XAML+'FrameworkElement',p,'double',0,true);
member(XAML+'FrameworkElement','FindName',['string'],'object');event(XAML+'FrameworkElement','Loaded');event(XAML+'FrameworkElement','Unloaded');
delegate(XAML+'RoutedEventHandler',['object',XAML+'RoutedEventArgs']);
define(XAML+'RoutedEventArgs',{kind:'object'});prop(XAML+'RoutedEventArgs','OriginalSource','object',null,true);prop(XAML+'RoutedEventArgs','Handled','bool',false);
}
