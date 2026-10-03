export function registerCoreControls12({define,member,ctor,prop,event,en,control,delegate,types,aliases,XAML,CONTROLS,MEDIA,TASK,THREAD}) {
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

}
