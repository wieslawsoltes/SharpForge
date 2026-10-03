import {registerRuntime14} from './runtime14-contracts.js';
import {registerWinUI13} from './winui13-contracts.js';
import {registerBcl} from './bcl-contracts.js';
/** A closed, versioned ABI. Unlisted members never fall through to host JavaScript. */
export const ABI_VERSION = 1;
export const XAML = 'Microsoft.UI.Xaml.';
export const CONTROLS = XAML + 'Controls.';
export const MEDIA = XAML + 'Media.';
export const TASK = 'System.Threading.Tasks.Task';
export const THREAD = 'System.Threading.Thread';
export const types = new Map();
const aliases = new Map();
function define(name, options = {}) {
  const t = {name, base: 'object', properties: {}, events: {}, ...options};
  types.set(name, t); aliases.set(name, name);
  const short = name.slice(name.lastIndexOf('.') + 1);
  if (!aliases.has(short)) aliases.set(short, name);
  return t;
}
export function canonicalType(type) {
  if (typeof type !== 'string') return type;
  // Compiler/metadata descriptors already contain canonical registered names.
  if (types.has(type)) return type;
  if (type.endsWith('[]')) return canonicalType(type.slice(0, -2)) + '[]';
  const collection = /^(?:System\.Collections\.Generic\.)?(List|Dictionary|HashSet|Queue|Stack)(?:`[12])?\s*<(.+)>$/.exec(type);
  if(collection){const args=collection[2].split(',').map(x=>canonicalType(x.trim()));return 'System.Collections.Generic.'+collection[1]+'`'+args.length+'<'+args.join(', ')+'>';}
  const vector=/^(?:System\.Numerics\.)?Vector(?:`1)?\s*<(.+)>$/.exec(type);if(vector)return 'System.Numerics.Vector`1<'+canonicalType(vector[1].trim())+'>';
  const task = /^(?:System\.Threading\.Tasks\.)?Task(?:`1)?\s*<(.+)>$/.exec(type);
  if (task) return TASK + '`1<' + canonicalType(task[1].trim()) + '>';
  const action = /^(?:System\.)?(Action|Func)(?:`[12])?\s*<(.+)>$/.exec(type);
  if (action) { const args = action[2].split(',').map(x => canonicalType(x.trim())); return 'System.' + action[1] + '`' + args.length + '<' + args.join(', ') + '>'; }
  return aliases.get(type) ?? type;
}
export function frameworkType(type) { return types.get(type) ?? types.get(canonicalType(type)) ?? null; }
export function frameworkAssignable(target, source) {
  target = canonicalType(target); source = canonicalType(source);
  if (target === source || target === 'object' && source !== 'void') return true;
  const seen = new Set();
  while (types.has(source) && !seen.has(source)) {
    seen.add(source); source = types.get(source).base;
    if (source === target) return true;
  }
  return false;
}
export function taskResult(type) {
  type = canonicalType(type);
  return type === TASK ? 'void' : type?.startsWith(TASK + '`1<') && type.endsWith('>') ? type.slice(TASK.length + 3, -1) : null;
}
export const contracts = [];
const memberIndex = new Map();
function member(owner, name, parameters, result, {isStatic = false, kind = 'method', ...extra} = {}) {
  owner = canonicalType(owner); parameters = parameters.map(canonicalType); result = canonicalType(result);
  const d = Object.freeze({id: contracts.length, owner, name, parameters, result, isStatic, kind, ...extra});
  contracts.push(d);
  const key = owner + '::' + name;
  if (!memberIndex.has(key)) memberIndex.set(key, []);
  memberIndex.get(key).push(d); return d;
}
function ctor(type, parameters = []) { return member(type, '.ctor', parameters, type, {kind: 'constructor'}); }
function prop(type, name, valueType, value = null, readOnly = false, isStatic = false) {
  const t = types.get(type); t.properties[name] = {type: canonicalType(valueType), value, readOnly, isStatic};
  const get = member(type, 'get_' + name, [], valueType, {kind: 'get', isStatic, property: name});
  const set = readOnly ? null : member(type, 'set_' + name, [valueType], 'void', {kind: 'set', isStatic, property: name});
  return {get, set};
}
function event(type, name, delegate = XAML + 'RoutedEventHandler') {
  types.get(type).events[name] = delegate;
  member(type, 'add_' + name, [delegate], 'void', {kind: 'eventAdd', event: name});
  member(type, 'remove_' + name, [delegate], 'void', {kind: 'eventRemove', event: name});
}
function en(name, values) { return define(name, {kind: 'enum', values, base: 'System.Enum'}); }
function delegate(name, parameters, result = 'void') {
  define(name, {kind: 'delegate', parameters: parameters.map(canonicalType), result: canonicalType(result), base: 'System.MulticastDelegate'});
  ctor(name, ['object', 'nint']); member(name, 'Invoke', parameters, result);
}
function control(name, base = 'Control', props = {}, events = []) {
  name = CONTROLS + name; define(name, {base: base.includes('.') ? base : CONTROLS + base, kind: 'control'}); ctor(name);
  for (const [key, v] of Object.entries(props)) prop(name, key, ...(Array.isArray(v) ? v : [v]));
  for (const key of events) event(name, key); return name;
}
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
export const colorValues = Object.freeze({Transparent:'#00000000',Black:'#000000',White:'#ffffff',Red:'#ff0000',Green:'#008000',Blue:'#0000ff',Orange:'#ffa500',Gray:'#808080',LightGray:'#d3d3d3',DarkGray:'#a9a9a9',Purple:'#800080',Yellow:'#ffff00',CornflowerBlue:'#6495ed',DodgerBlue:'#1e90ff'});
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
define(CONTROLS+'Control',{base:XAML+'FrameworkElement',kind:'abstract'});
for(const [n,t,v]of [['IsEnabled','bool',true],['TabIndex','int',0],['IsTabStop','bool',true],['FontSize','double',14],['FontFamily','string','Segoe UI'],['Foreground',MEDIA+'Brush',null],['Background',MEDIA+'Brush',null],['Padding',XAML+'Thickness',null],['BorderBrush',MEDIA+'Brush',null],['BorderThickness',XAML+'Thickness',null],['CornerRadius',XAML+'CornerRadius',null]])prop(CONTROLS+'Control',n,t,v);
member(CONTROLS+'Control','Focus',[],'bool');
control('ContentControl','Control',{Content:'object'});
control('Page','ContentControl');control('UserControl','ContentControl');
control('Button','ContentControl',{},['Click']);control('CheckBox','ContentControl',{IsChecked:['bool',false]},['Checked','Unchecked','Click']);
control('ToggleSwitch','Control',{Header:'object',IsOn:['bool',false],OnContent:['object','On'],OffContent:['object','Off']},['Toggled']);
control('TextBox','Control',{Text:['string',''],PlaceholderText:['string',''],Header:'object',IsReadOnly:['bool',false],AcceptsReturn:['bool',false],MaxLength:['int',0],TextWrapping:[XAML+'TextWrapping',0]},['TextChanged']);
control('PasswordBox','Control',{Password:['string',''],PlaceholderText:['string',''],Header:'object'},['PasswordChanged']);
control('TextBlock',XAML+'FrameworkElement',{Text:['string',''],FontSize:['double',14],Foreground:MEDIA+'Brush',TextWrapping:[XAML+'TextWrapping',0],TextAlignment:[XAML+'TextAlignment',0],IsTextSelectionEnabled:['bool',true]});
control('Border',XAML+'FrameworkElement',{Child:XAML+'UIElement',Background:MEDIA+'Brush',Padding:XAML+'Thickness',BorderBrush:MEDIA+'Brush',BorderThickness:XAML+'Thickness',CornerRadius:XAML+'CornerRadius'});
control('Panel',XAML+'FrameworkElement',{Background:MEDIA+'Brush'});
control('StackPanel','Panel',{Orientation:[CONTROLS+'Orientation',0],Spacing:['double',0],Padding:XAML+'Thickness',BorderBrush:MEDIA+'Brush',BorderThickness:XAML+'Thickness',CornerRadius:XAML+'CornerRadius'});
control('Grid','Panel',{RowSpacing:['double',0],ColumnSpacing:['double',0],Padding:XAML+'Thickness',BorderBrush:MEDIA+'Brush',BorderThickness:XAML+'Thickness',CornerRadius:XAML+'CornerRadius'});
control('Canvas','Panel');
control('ScrollViewer','ContentControl',{HorizontalScrollBarVisibility:[CONTROLS+'ScrollBarVisibility',1],VerticalScrollBarVisibility:[CONTROLS+'ScrollBarVisibility',1]});
control('Slider','Control',{Minimum:['double',0],Maximum:['double',100],Value:['double',0],StepFrequency:['double',1],Header:'object',Orientation:[CONTROLS+'Orientation',1]},['ValueChanged']);
control('ProgressBar','Control',{Minimum:['double',0],Maximum:['double',100],Value:['double',0],IsIndeterminate:['bool',false]});
control('ProgressRing','Control',{IsActive:['bool',true],IsIndeterminate:['bool',true],Value:['double',0]});
control('ComboBox','Control',{Header:'object',PlaceholderText:['string',''],SelectedIndex:['int',-1],SelectedItem:'object'},['SelectionChanged']);
control('ListView','Control',{SelectedIndex:['int',-1],SelectedItem:'object'},['SelectionChanged']);
control('ComboBoxItem','ContentControl');control('ListViewItem','ContentControl');
control('Image',XAML+'FrameworkElement',{Source:['string',''],AlternativeText:['string','']});
control('HyperlinkButton','ContentControl',{NavigateUri:['string','']},['Click']);
control('Expander','ContentControl',{Header:'object',IsExpanded:['bool',false]},['Expanding','Collapsed']);
control('MenuFlyoutItem','Control',{Text:['string','']},['Click']);
control('MenuFlyout','Control');
control('NavigationView','ContentControl',{Header:'object',IsPaneOpen:['bool',true],SelectedItem:'object'},['SelectionChanged']);
control('NavigationViewItem','ContentControl',{Tag:'object'});
define('SharpForge.UI.DrawingSurface',{base:XAML+'FrameworkElement',kind:'control'});ctor('SharpForge.UI.DrawingSurface');prop('SharpForge.UI.DrawingSurface','Background',MEDIA+'Brush');
// An explicit extension for portable GPU/Canvas drawing; not presented as a WinUI class.
member('SharpForge.UI.DrawingSurface','Clear',[],'void');
member('SharpForge.UI.DrawingSurface','FillRectangle',['double','double','double','double','Windows.UI.Color'],'void');
member('SharpForge.UI.DrawingSurface','DrawLine',['double','double','double','double','double','Windows.UI.Color'],'void');
for(const name of ['UIElementCollection','ItemCollection','RowDefinitionCollection','ColumnDefinitionCollection']){
  define(CONTROLS+name,{kind:'collection'});prop(CONTROLS+name,'Count','int',0,true);
  const item=name==='UIElementCollection'?XAML+'UIElement':name==='ItemCollection'?'object':CONTROLS+name.replace('Collection','');
  member(CONTROLS+name,'Add',[item],'void');member(CONTROLS+name,'Clear',[],'void');member(CONTROLS+name,'Remove',[item],'bool');member(CONTROLS+name,'RemoveAt',['int'],'void');member(CONTROLS+name,'Insert',['int',item],'void');member(CONTROLS+name,'get_Item',['int'],item);
}
prop(CONTROLS+'Panel','Children',CONTROLS+'UIElementCollection',null,true);
for(const n of ['ComboBox','ListView','MenuFlyout','NavigationView'])prop(CONTROLS+n,n==='NavigationView'?'MenuItems':'Items',CONTROLS+'ItemCollection',null,true);
for(const n of ['Row','Column']){control(n+'Definition',XAML+'DependencyObject',{[n==='Row'?'Height':'Width']:XAML+'GridLength'});prop(CONTROLS+'Grid',n+'Definitions',CONTROLS+n+'DefinitionCollection',null,true);}
for(const n of ['Row','Column','RowSpan','ColumnSpan']){member(CONTROLS+'Grid','Set'+n,[XAML+'FrameworkElement','int'],'void',{isStatic:true,kind:'attachedSet',property:n});member(CONTROLS+'Grid','Get'+n,[XAML+'FrameworkElement'],'int',{isStatic:true,kind:'attachedGet',property:n});}
for(const n of ['Left','Top','ZIndex']){member(CONTROLS+'Canvas','Set'+n,[XAML+'UIElement',n==='ZIndex'?'int':'double'],'void',{isStatic:true,kind:'attachedSet',property:n});member(CONTROLS+'Canvas','Get'+n,[XAML+'UIElement'],n==='ZIndex'?'int':'double',{isStatic:true,kind:'attachedGet',property:n});}
define(XAML+'Window',{kind:'window'});ctor(XAML+'Window');prop(XAML+'Window','Content',XAML+'UIElement');prop(XAML+'Window','Title','string','SharpForge application');member(XAML+'Window','Activate',[],'void');member(XAML+'Window','Close',[],'void');event(XAML+'Window','Closed');
define(XAML+'Application',{kind:'application'});ctor(XAML+'Application');prop(XAML+'Application','Current',XAML+'Application',null,true,true);member(XAML+'Application','Exit',[],'void');
define('SharpForge.Runtime.Async',{kind:'static'});
// Managed cooperative concurrency contracts. These are logical contexts, not OS threads.
delegate('System.Action',[]);
for(const r of ['int','double','bool','string','object'])delegate('System.Func`1<'+r+'>',[],r);
delegate('System.Threading.ThreadStart',[]);
define(THREAD,{kind:'thread'});ctor(THREAD,['System.Threading.ThreadStart']);prop(THREAD,'Name','string','');prop(THREAD,'ManagedThreadId','int',0,true);prop(THREAD,'IsAlive','bool',false,true);prop(THREAD,'CurrentThread',THREAD,null,true,true);member(THREAD,'Start',[],'void');member(THREAD,'Join',[],'void');member(THREAD,'Sleep',['int'],'void',{isStatic:true});member(THREAD,'Yield',[],'bool',{isStatic:true});
for(const r of ['void','int','double','bool','string','object']){
  const t=r==='void'?TASK:TASK+'`1<'+r+'>';define(t,{kind:'task',result:r,base:r==='void'?'object':TASK});
  prop(t,'Id','int',0,true);prop(t,'IsCompleted','bool',false,true);prop(t,'IsFaulted','bool',false,true);prop(t,'IsCanceled','bool',false,true);if(r!=='void')prop(t,'Result',r,null,true);
  member(t,'Wait',[],'void');
  // Await is a private ABI intrinsic emitted for the restricted async lowering.
  member('SharpForge.Runtime.Async','Await',[t],r,{isStatic:true,kind:'await'});
  member('SharpForge.Runtime.Async','Start',[r==='void'?'System.Action':'System.Func`1<'+r+'>'],t,{isStatic:true,kind:'startTask'});
}
member(TASK,'Delay',['int'],TASK,{isStatic:true});member(TASK,'Yield',[],TASK,{isStatic:true});prop(TASK,'CompletedTask',TASK,null,true,true);
member(TASK,'Run',['System.Action'],TASK,{isStatic:true,kind:'startTask'});
for(const r of ['int','double','bool','string','object'])member(TASK,'Run',['System.Func`1<'+r+'>'],TASK+'`1<'+r+'>',{isStatic:true,kind:'startTask'});
member(TASK,'WhenAll',[TASK+'[]'],TASK,{isStatic:true});member(TASK,'WhenAny',[TASK+'[]'],TASK+'`1<object>',{isStatic:true});
member(TASK,'FromResult',['int'],TASK+'`1<int>',{isStatic:true});member(TASK,'FromResult',['string'],TASK+'`1<string>',{isStatic:true});

const SHAPES=XAML+'Shapes.';
define(SHAPES+'Shape',{base:XAML+'FrameworkElement',kind:'abstract'});
prop(SHAPES+'Shape','Fill',MEDIA+'Brush');prop(SHAPES+'Shape','Stroke',MEDIA+'Brush');prop(SHAPES+'Shape','StrokeThickness','double',1);
for(const n of ['Rectangle','Ellipse','Line']){define(SHAPES+n,{base:SHAPES+'Shape',kind:'shape'});ctor(SHAPES+n);}
for(const n of ['RadiusX','RadiusY'])prop(SHAPES+'Rectangle',n,'double',0);
for(const n of ['X1','Y1','X2','Y2'])prop(SHAPES+'Line',n,'double',0);
member(CONTROLS+'MenuFlyout','ShowAt',[XAML+'FrameworkElement'],'void');member(CONTROLS+'MenuFlyout','Hide',[],'void');
prop(CONTROLS+'Button','Flyout',CONTROLS+'MenuFlyout');prop(XAML+'UIElement','ContextFlyout',CONTROLS+'MenuFlyout');

// 0.12 code-first controls and styling contracts. Appended to preserve prior ABI ids.
control('ToggleButton','ContentControl',{IsChecked:['bool',false]},['Click','Checked','Unchecked']);
control('RadioButton','ContentControl',{IsChecked:['bool',false],GroupName:['string','']},['Checked','Unchecked','Click']);
control('NumberBox','Control',{Value:['double',0],Minimum:['double',-1000000000],Maximum:['double',1000000000],SmallChange:['double',1],Header:'object',PlaceholderText:['string',''],IsReadOnly:['bool',false]},['ValueChanged']);
control('AutoSuggestBox','TextBox',{},['QuerySubmitted']);
control('CalendarDatePicker','Control',{Date:['string',''],PlaceholderText:['string','Select date'],Header:'object'},['DateChanged']);
control('TimePicker','Control',{Time:['string','12:00'],Header:'object'},['TimeChanged']);
control('InfoBar','ContentControl',{Title:['string',''],Message:['string',''],IsOpen:['bool',true],IsClosable:['bool',true],Severity:['int',0]},['Closed']);
control('ContentPresenter','ContentControl');
en(MEDIA+'Stretch',{None:0,Fill:1,Uniform:2,UniformToFill:3});
control('Viewbox','ContentControl',{Stretch:[MEDIA+'Stretch',2]});
control('TabView','Control',{SelectedIndex:['int',0]},['SelectionChanged']);
control('TabViewItem','ContentControl',{Header:'object',IsClosable:['bool',true]},['CloseRequested']);
control('AppBarButton','Button',{Label:['string','']});
control('CommandBar','Panel');
control('ToolTip','ContentControl',{IsOpen:['bool',true]});
control('ContentDialog','ContentControl',{Title:'object',PrimaryButtonText:['string','OK'],SecondaryButtonText:['string',''],CloseButtonText:['string','Close'],IsOpen:['bool',false]},['PrimaryButtonClick','SecondaryButtonClick','CloseButtonClick']);
member(CONTROLS+'ContentDialog','Show',[],'void');member(CONTROLS+'ContentDialog','Hide',[],'void');
prop(CONTROLS+'TabView','TabItems',CONTROLS+'ItemCollection',null,true);
// Decorative, nonfocusable Separator is exposed in Controls by this web profile.
control('Separator',XAML+'FrameworkElement',{Background:MEDIA+'Brush'});
prop(CONTROLS+'CommandBar','Children',CONTROLS+'UIElementCollection',null,true);
define(XAML+'DependencyProperty',{kind:'dependencyProperty'});
prop(XAML+'DependencyProperty','Name','string','',true);
prop(XAML+'DependencyProperty','UnsetValue','object',null,true,true);
define(XAML+'Setter',{kind:'setter'});ctor(XAML+'Setter');ctor(XAML+'Setter',[XAML+'DependencyProperty','object']);
prop(XAML+'Setter','Property',XAML+'DependencyProperty');prop(XAML+'Setter','Value','object');
define(XAML+'SetterBaseCollection',{kind:'collection'});prop(XAML+'SetterBaseCollection','Count','int',0,true);
for(const [name,args,result]of [['Add',[XAML+'Setter'],'void'],['Clear',[],'void'],['Remove',[XAML+'Setter'],'bool'],['RemoveAt',['int'],'void'],['Insert',['int',XAML+'Setter'],'void'],['get_Item',['int'],XAML+'Setter']])member(XAML+'SetterBaseCollection',name,args,result);
define(XAML+'Style',{kind:'style'});ctor(XAML+'Style');ctor(XAML+'Style',['string']);
prop(XAML+'Style','TargetTypeName','string','');prop(XAML+'Style','BasedOn',XAML+'Style');prop(XAML+'Style','Setters',XAML+'SetterBaseCollection',null,true);
define(CONTROLS+'ControlTemplate',{kind:'template'});ctor(CONTROLS+'ControlTemplate');
prop(CONTROLS+'ControlTemplate','TargetTypeName','string','');prop(CONTROLS+'ControlTemplate','VisualTree',XAML+'UIElement');
member(CONTROLS+'ControlTemplate','Bind',[XAML+'FrameworkElement','string',XAML+'DependencyProperty'],'void');
prop(XAML+'FrameworkElement','Style',XAML+'Style');prop(CONTROLS+'Control','Template',CONTROLS+'ControlTemplate');
member(CONTROLS+'Control','ApplyTemplate',[],'bool');member(CONTROLS+'Control','GetTemplateChild',['string'],XAML+'DependencyObject');
for(const [name,args,result]of [['GetValue',[XAML+'DependencyProperty'],'object'],['SetValue',[XAML+'DependencyProperty','object'],'void'],['ClearValue',[XAML+'DependencyProperty'],'void'],['ReadLocalValue',[XAML+'DependencyProperty'],'object']])member(XAML+'DependencyObject',name,args,result);
// Static dependency-property identifiers use the declaring type, including inherited lookup.
for(const type of [...types.values()])if(['control','abstract','shape'].includes(type.kind))for(const [name,p]of Object.entries({...type.properties}))if(!p.isStatic&&!p.readOnly)prop(type.name,name+'Property',XAML+'DependencyProperty',null,true,true);

registerBcl({define,member,ctor,prop});
registerWinUI13({define,member,ctor,prop,event,en,control,types});
registerRuntime14({define,member,ctor,prop,en,delegate});

export function findContracts(owner, name, isStatic) {
  owner=canonicalType(owner);const result=[],seen=new Set();
  while(owner&&!seen.has(owner)){seen.add(owner);result.push(...(memberIndex.get(owner+'::'+name)??[]).filter(d=>isStatic===undefined||d.isStatic===isStatic));owner=types.get(owner)?.base;}
  return result;
}
export function contractForMember(d) {
  if(!d?.signature)return null;const owner=canonicalType(d.owner);
  return findContracts(owner,d.name,d.signature.isStatic).find(c=>c.parameters.length===d.signature.parameters.length&&c.parameters.every((t,i)=>t===canonicalType(d.signature.parameters[i]))&&(c.kind==='constructor'?'void':c.result)===canonicalType(d.signature.returnType))??null;
}
export function propertiesFor(type) {
  const list=[];const seen=new Set();while(types.has(type)&&!seen.has(type)){seen.add(type);list.unshift(types.get(type));type=types.get(type).base;}
  return Object.assign({},...list.map(t=>t.properties));
}
export function eventsFor(type){const result={};const seen=new Set();while(types.has(type)&&!seen.has(type)){seen.add(type);Object.assign(result,types.get(type).events);type=types.get(type).base;}return result;}
export function enumValue(path) {
  const dot=path?.lastIndexOf('.')??-1;if(dot<0)return null;const t=frameworkType(path.slice(0,dot)),name=path.slice(dot+1);
  return t?.kind==='enum'&&Object.hasOwn(t.values,name)?{type:t.name,value:t.values[name]}:null;
}
export const enumTypes=Object.freeze([...types.values()].filter(t=>t.kind==='enum').map(t=>t.name));
export const frameworkManifest=Object.freeze({version:ABI_VERSION,types:[...types.values()].map(t=>({...t})),members:contracts});

export {AnimationClock,prepareTimeline,timelinePosition,easing} from './animation-clock.js';
