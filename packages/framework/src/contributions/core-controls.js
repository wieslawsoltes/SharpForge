export function registerCoreControls({define,member,ctor,prop,event,en,control,delegate,types,aliases,XAML,CONTROLS,MEDIA,TASK,THREAD}) {
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
}
