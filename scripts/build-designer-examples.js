/** Reproducible code-first designer projects. No native SDK or network access. */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createDesign,DesignDocument,generateDesignProject} from '@sharpforge/designer';
import {exportWorkspaceZip} from '@sharpforge/project-system';
const root=fileURLToPath(new URL('../',import.meta.url));
async function save(name,records){const dir=join(root,'examples/designer',name);await mkdir(dir,{recursive:true});for(const r of records){await mkdir(join(dir,r.path,'..'),{recursive:true});await writeFile(join(dir,r.path),r.text??r.bytes);}await writeFile(join(root,'examples/designer',name+'.zip'),exportWorkspaceZip({records,folders:[],settings:{entry:'DesignerApp.slnx',startup:'DesignerApp.csproj'}}));}
const canvas=new DesignDocument(createDesign('Live Designer Counter'));
const input=canvas.add('TextBox','canvas',{Name:'Input',Text:'Hello',Left:50,Top:236,Width:320,Height:36});
canvas.setTemplate('InputFrame',{targetType:'TextBox',root:{id:'frame',type:'Border',properties:{Padding:8,Background:'#303a48',CornerRadius:6},children:[{id:'input',type:'TextBox',properties:{Name:'PART_Input'},bindings:{Text:'Text'},children:[]}]}});
canvas.setReference('template','InputFrame',[input]);
const records=generateDesignProject(canvas.value);
records.find(r=>r.path==='Program.cs').text=`using Microsoft.UI.Xaml;\nclass Program\n{\n    static int count;\n    static void Main() { DesignedView.Create(); }\n    public static void OnAction(object sender, RoutedEventArgs args)\n    {\n        count++;\n        DesignedView.v_title.Text = DesignedView.v_${input}.Text + ": " + count;\n    }\n}\n`;
await save('CanvasCounter',records);
const grid=new DesignDocument(createDesign('Responsive Grid Designer'));
grid.change('Use Grid',d=>{const n=d.nodes.find(n=>n.id==='canvas');n.type='Microsoft.UI.Xaml.Controls.Grid';for(const c of d.nodes){delete c.properties.Left;delete c.properties.Top;}n.properties.Padding={valueType:'Microsoft.UI.Xaml.Thickness',Left:24,Top:24,Right:24,Bottom:24};});
grid.tracks('canvas',['Auto','*','Auto'],['2*','*']);grid.setProperty('Row',1,['caption']);grid.setProperty('Column',1,['action']);grid.setProperty('Row',2,['action']);grid.setProperty('FontSize',20,['title']);
const number=grid.add('NumberBox','canvas',{Name:'Amount',Value:42,Width:200,Row:1,Column:1});
const info=grid.add('InfoBar','canvas',{Title:'Designer workspace',Message:'Edit Grid tracks and shared styles without recreating managed objects.',Row:2,Column:0,Width:550});
await save('GridWorkspace',generateDesignProject(grid.value));
const styles=`using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
class Program
{
    static TextBox input;
    static TextBlock status;
    static Setter fontSize;
    static int count;
    static void Change(object sender, RoutedEventArgs args)
    {
        count++;
        fontSize.Value = 18.0 + count;
        status.Text = input.Text + ": " + count;
    }
    static void Main()
    {
        Style style = new Style("Button");
        fontSize = new Setter(Button.FontSizeProperty, 18.0);
        style.Setters.Add(fontSize);
        style.Setters.Add(new Setter(Button.PaddingProperty, new Thickness(12)));
        ControlTemplate template = new ControlTemplate();
        template.TargetTypeName = "TextBox";
        Border border = new Border();
        border.Padding = new Thickness(8);
        TextBox part = new TextBox();
        part.Name = "PART_Input";
        border.Child = part;
        template.VisualTree = border;
        template.Bind(part, "Text", TextBox.TextProperty);
        input = new TextBox(); input.Name = "StyledInput"; input.Text = "Type here"; input.Template = template;
        TextBox second = new TextBox(); second.Text = "Independent instance"; second.Template = template;
        Button button = new Button(); button.Content = "Change shared style"; button.Style = style; button.Click += Change;
        Button follower = new Button(); follower.Content = "Shared style follower"; follower.Style = style;
        status = new TextBlock(); status.Text = "Ready";
        StackPanel panel = new StackPanel(); panel.Padding = new Thickness(24); panel.Spacing = 12;
        panel.Children.Add(input); panel.Children.Add(second); panel.Children.Add(button); panel.Children.Add(follower); panel.Children.Add(status);
        Window window = new Window(); window.Title = "Shared styles and instance templates"; window.Content = panel; window.Activate();
    }
}
`;
const gallery=`using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Program
{
    static NumberBox amount; static TextBlock status; static TabView tabs; static TabViewItem second;
    static void Changed(object sender, RoutedEventArgs args) { status.Text = "Amount: " + amount.Value; }
    static void CloseTab(object sender, RoutedEventArgs args) { tabs.TabItems.Remove(second); }
    static void Main()
    {
        StackPanel panel = new StackPanel(); panel.Spacing = 10; panel.Padding = new Thickness(24);
        status = new TextBlock(); status.Text = "Interactive control gallery"; status.FontSize = 24;
        amount = new NumberBox(); amount.Name = "Amount"; amount.Header = "Amount"; amount.Value = 42; amount.Minimum = 0; amount.Maximum = 100; amount.ValueChanged += Changed;
        AutoSuggestBox search = new AutoSuggestBox(); search.PlaceholderText = "Search (text input)";
        ToggleButton toggle = new ToggleButton(); toggle.Content = "Toggle selection";
        RadioButton radio1 = new RadioButton(); radio1.Content = "First"; radio1.GroupName = "Demo";
        RadioButton radio2 = new RadioButton(); radio2.Content = "Second"; radio2.GroupName = "Demo";
        CalendarDatePicker date = new CalendarDatePicker(); date.Date = "2026-10-03";
        TimePicker time = new TimePicker(); time.Time = "14:30";
        InfoBar info = new InfoBar(); info.Title = "Managed controls"; info.Message = "Inputs update managed state. Close the second tab.";
        tabs = new TabView(); TabViewItem first = new TabViewItem(); first.Header = "Home"; first.Content = "First tab content"; first.IsClosable = false;
        second = new TabViewItem(); second.Header = "Details"; second.Content = "Closable tab content"; second.CloseRequested += CloseTab;
        tabs.TabItems.Add(first); tabs.TabItems.Add(second);
        panel.Children.Add(status); panel.Children.Add(amount); panel.Children.Add(search); panel.Children.Add(toggle); panel.Children.Add(radio1); panel.Children.Add(radio2); panel.Children.Add(date); panel.Children.Add(time); panel.Children.Add(info); panel.Children.Add(tabs);
        ScrollViewer scroll = new ScrollViewer(); scroll.Content = panel;
        Window window = new Window(); window.Title = "Expanded WinUI controls"; window.Content = scroll; window.Activate();
    }
}
`;
for(const [name,source]of [['SharedStyles',styles],['ControlGallery',gallery]])await save(name,[{path:'Program.cs',text:source},{path:'DesignerApp.csproj',text:'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><SharpForgeProfile>WinUIWeb</SharpForgeProfile></PropertyGroup></Project>\n'},{path:'DesignerApp.slnx',text:'<Solution><Project Path="DesignerApp.csproj" /></Solution>\n'}]);
const enc=`class Counter\n{\n    public int Value = 40;\n}\nclass Program\n{\n    static int Adjust(int value) { return value + 2; }\n    static void Main()\n    {\n        Counter counter = new Counter();\n        int value = counter.Value;\n        value++;\n        Console.WriteLine(Adjust(value));\n    }\n}\n`;
const encNext=enc.replace('public int Value = 40;','public int Value = 40;\n    public int Added = 99;').replace('return value + 2;','return Helper(value);').replace('    static void Main()', '    static int Helper(int value) { return value + 10; }\n    static void Main()');
await save('EditContinue',[{path:'Program.cs',text:enc},{path:'Program.after.cs.txt',text:encNext},{path:'DesignerApp.csproj',text:'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>\n'},{path:'DesignerApp.slnx',text:'<Solution><Project Path="DesignerApp.csproj" /></Solution>\n'},{path:'README.md',text:'# Edit and Continue\n\nDebug the source VM, break before `value++`, open Hot Reload, Edit code, paste Program.after.cs.txt into Program.cs and Apply. Existing `counter.Value` stays 40; its appended Added field defaults to 0. A newly constructed Counter initializes Added to 99. Continue prints 51. Without an update it prints 43. The direct-CIL path rejects structural changes; use source mode for this example.\n'}]);
const entries=[{id:'designer-canvas',name:'Designer · live Canvas counter',description:'Code generated from examples/designer/CanvasCounter/View.sfdesign.json. Run, open Designer, Attach running app; pixel/style/template edits preserve typed text and count.',ui:true,expectedOutput:'',files:records.filter(r=>r.path.endsWith('.cs')).map(r=>({uri:r.path,text:r.text}))},{id:'designer-grid',name:'Designer · Grid tracks and layout',description:'Grid Auto/pixel/star tracks, NumberBox, InfoBar and shared styles. Attach running app to edit the real managed tree.',ui:true,expectedOutput:'',files:generateDesignProject(grid.value).filter(r=>r.path.endsWith('.cs')).map(r=>({uri:r.path,text:r.text}))},{id:'winui-shared-styles',name:'WinUI · shared styles and templates',description:'Shared Setter mutation, Thickness, distinct template name scopes and managed text/click handlers.',ui:true,expectedOutput:'',files:[{uri:'Program.cs',text:styles}]},{id:'winui-expanded-controls',name:'WinUI · expanded controls gallery',description:'NumberBox, radio groups, date/time input, toggles, InfoBar and closable tabs. Web-profile contracts are listed in the guide.',ui:true,expectedOutput:'',files:[{uri:'Program.cs',text:gallery}]},{id:'edit-continue-structure',name:'Edit and Continue · methods and fields',description:'Source VM: pause before value++, add Helper and a Counter field without rebuilding live objects. Complete before/after source in examples/designer/EditContinue.',expectedOutput:'43\n',files:[{uri:'Program.cs',text:enc}],debug:{breakpoints:{'Program.cs':[{line:12}]},watches:['value','counter.Value']}}];
await writeFile(join(root,'apps/studio/samples-designer.js'),'// Generated by scripts/build-designer-examples.js\nexport const designerSamples='+JSON.stringify(entries,null,2)+';\n');
console.log('Generated 5 designer/EnC projects, ZIPs, and Studio examples.');
