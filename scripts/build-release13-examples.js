import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {exportWorkspaceZip} from '@sharpforge/project-system';
const root=fileURLToPath(new URL('../',import.meta.url));
const sync=`using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
class Program
{
    static int count;
    static TextBlock summary;
    // Designer owns this declarative construction method, not the handlers below.
    static Window Create()
    {
        var window = new Window() { Title = "Source + Design Studio" };
        var surface = new Canvas() { Name = "Surface", Width = 920, Height = 560, Background = new SolidColorBrush(Colors.Black) };
        var eyebrow = new TextBlock() { Text = "SHARPFORGE / TWO-WAY AUTHORING", FontSize = 13, Foreground = new SolidColorBrush(Colors.CornflowerBlue) };
        Canvas.SetLeft(eyebrow, 42); Canvas.SetTop(eyebrow, 30);
        var title = new TextBlock() { Name = "Heading", Text = "Code and design, together.", FontSize = 34, Width = 820, Foreground = new SolidColorBrush(Colors.White) };
        Canvas.SetLeft(title, 40); Canvas.SetTop(title, 76);
        var subtitle = new TextBlock() { Text = "Change properties here. Edit the same C# in the full editor.", FontSize = 17, Width = 820, Foreground = new SolidColorBrush(Colors.Gray) };
        Canvas.SetLeft(subtitle, 42); Canvas.SetTop(subtitle, 135);
        var card = new Border() { Width = 824, Height = 178, Padding = new Thickness(24), CornerRadius = new CornerRadius(12), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 34, 48, 58)) };
        Canvas.SetLeft(card, 42); Canvas.SetTop(card, 198);
        var content = new StackPanel() { Spacing = 14 };
        var heading = new TextBlock() { Text = "Your code stays yours", FontSize = 22, Foreground = new SolidColorBrush(Colors.White) };
        summary = new TextBlock() { Name = "Summary", Text = "0 edits applied / handlers are preserved", FontSize = 18, Foreground = new SolidColorBrush(Colors.LightGray) };
        var note = new TextBlock() { Text = "Source spans / version checks / compile-checked updates", FontSize = 14, Foreground = new SolidColorBrush(Colors.LightGray) };
        content.Children.Add(heading); content.Children.Add(summary); content.Children.Add(note); card.Child = content;
        var action = new Button() { Name = "ApplyButton", Content = "Run managed action", Width = 208, Height = 44, FontSize = 15, Background = new SolidColorBrush(Colors.DodgerBlue), Foreground = new SolidColorBrush(Colors.White) };
        Canvas.SetLeft(action, 42); Canvas.SetTop(action, 416); action.Click += OnAction;
        var footer = new TextBlock() { Text = "Try Designer → Connect C# → Program.cs", FontSize = 14, Foreground = new SolidColorBrush(Colors.Gray) };
        Canvas.SetLeft(footer, 278); Canvas.SetTop(footer, 429);
        surface.Children.Add(eyebrow); surface.Children.Add(title); surface.Children.Add(subtitle); surface.Children.Add(card); surface.Children.Add(action); surface.Children.Add(footer);
        window.Content = surface;
        return window;
    }
    // This hand-written logic remains byte-for-byte untouched by property updates.
    static void OnAction(object sender, RoutedEventArgs args)
    {
        count++;
        var features = new List<string>() { "C#", "Designer", "Managed events" };
        summary.Text = $"Action {count:D2}: {string.Join(" / ", features.ToArray())}";
    }
    static void Main() { Create().Activate(); }
}
`;
const animation=`using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
class Program
{
    static Storyboard motion;
    static TextBlock status;
    static void Play(object sender, RoutedEventArgs e) { motion.Begin(); status.Text = "Playing"; }
    static void Pause(object sender, RoutedEventArgs e) { motion.Pause(); status.Text = "Paused"; }
    static void Resume(object sender, RoutedEventArgs e) { motion.Resume(); status.Text = "Playing"; }
    static void Stop(object sender, RoutedEventArgs e) { motion.Stop(); status.Text = "Stopped — base value restored"; }
    static void Completed(object sender, RoutedEventArgs e) { status.Text = "Complete — play again"; }
    static void Main()
    {
        var panel = new StackPanel() { Padding = new Thickness(28), Spacing = 18 };
        panel.Children.Add(new TextBlock() { Text = "Managed storyboard playback", FontSize = 28 });
        status = new TextBlock() { Name = "AnimationStatus", Text = "Ready", FontSize = 16 };
        var track = new Canvas() { Width = 620, Height = 110 };
        var tile = new Button() { Name = "AnimatedTile", Content = "Animated", Width = 160, Height = 48 };
        tile.RenderTransform = new TranslateTransform(); Canvas.SetTop(tile, 24); track.Children.Add(tile);
        var animation = new DoubleAnimation() { From = 0, To = 380, Duration = new Duration(TimeSpan.FromSeconds(2)), AutoReverse = true, EasingFunction = new SineEase() { EasingMode = EasingMode.EaseInOut } };
        Storyboard.SetTarget(animation, tile); Storyboard.SetTargetProperty(animation, "RenderTransform.X");
        motion = new Storyboard(); motion.Children.Add(animation); motion.Completed += Completed;
        var controls = new StackPanel() { Orientation = Orientation.Horizontal, Spacing = 10 };
        var play = new Button() { Content = "Play" }; play.Click += Play;
        var pause = new Button() { Content = "Pause" }; pause.Click += Pause;
        var resume = new Button() { Content = "Resume" }; resume.Click += Resume;
        var stop = new Button() { Content = "Stop" }; stop.Click += Stop;
        controls.Children.Add(play); controls.Children.Add(pause); controls.Children.Add(resume); controls.Children.Add(stop);
        panel.Children.Add(track); panel.Children.Add(controls); panel.Children.Add(status);
        var window = new Window() { Title = "Storyboard + managed callbacks", Content = panel }; window.Activate();
    }
}
`;
const wrap=`using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
class Program
{
    static void Main()
    {
        var items = new VariableSizedWrapGrid() { Name = "Cards", Width = 780, Height = 380, ItemWidth = 180, ItemHeight = 84, MaximumRowsOrColumns = 4, Orientation = Orientation.Horizontal };
        for (int i = 0; i < 9; i++)
        {
            var button = new Button() { Content = $"Card {i + 1:D2}", Margin = new Thickness(5), FontSize = 18 };
            if (i == 0) { VariableSizedWrapGrid.SetColumnSpan(button, 2); button.Background = new SolidColorBrush(Colors.DodgerBlue); }
            items.Children.Add(button);
        }
        var panel = new StackPanel() { Padding = new Thickness(24), Spacing = 16 };
        panel.Children.Add(new TextBlock() { Text = "Wrapping layouts with real cell spans", FontSize = 26 }); panel.Children.Add(items);
        var window = new Window() { Content = panel }; window.Activate();
    }
}
`;
const style=`using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
class Program
{
    static void Main()
    {
        var style = new Style("Button"); var baseOpacity = new Setter(Button.OpacityProperty, 0.4); style.Setters.Add(baseOpacity);
        var button = new Button() { Style = style };
        var animation = new DoubleAnimation() { From = 0, To = 1, Duration = new Duration(TimeSpan.FromSeconds(1)) };
        Storyboard.SetTarget(animation, button); Storyboard.SetTargetProperty(animation, "Opacity");
        var storyboard = new Storyboard(); storyboard.Children.Add(animation); storyboard.Begin();
        SharpForge.UI.AnimationClock.AdvanceBy(500); Console.WriteLine(button.Opacity);
        baseOpacity.Value = 0.8; Console.WriteLine(button.Opacity);
        storyboard.Stop(); Console.WriteLine(button.Opacity);
    }
}
`;
const entries=[
 {id:'designer-csharp-sync',name:'Designer · C# two-way editing',description:'Open Designer, Connect C# → Program.cs. The Create method maps to the canvas and properties. OnAction remains user-owned. Try text edits, resize, toolbox insertion, undo, and source changes.',ui:true,expectedOutput:'',files:[{uri:'Program.cs',text:sync}]},
 {id:'winui-storyboards',name:'WinUI · storyboard playback',description:'Play/Pause/Resume/Stop a transform animation with easing and AutoReverse. Completed executes managed C#. Animations freeze at debugger stops.',ui:true,expectedOutput:'',files:[{uri:'Program.cs',text:animation}]},
 {id:'winui-wrap-panels',name:'WinUI · wrapping panels and spans',description:'VariableSizedWrapGrid with horizontal layout, four cells per row and a two-cell featured card. Uses interpolated labels.',ui:true,expectedOutput:'',files:[{uri:'Program.cs',text:wrap}]},
 {id:'animation-style-precedence',name:'WinUI · animation and style precedence',description:'Deterministic headless animation: animated values temporarily override styles. Stopping restores the most recent style value, not its old snapshot.',expectedOutput:'0.5\n0.5\n0.8\n',files:[{uri:'Program.cs',text:style}]},
 {id:'bcl-collections',name:'BCL · lists, sets, queues and stacks',description:'Closed primitive collection types, collection initializers, indexers and disposable foreach enumerators. No general user-defined generic type support is implied.',expectedOutput:'1,2,3\n3\nfirst\n2\n',files:[{uri:'Program.cs',text:'using System.Collections.Generic;\nvar numbers = new List<int>() { 3, 1, 2 };\nnumbers.Sort();\nConsole.WriteLine(string.Join(",", numbers.ToArray()));\nvar unique = new HashSet<int>(new int[] { 1, 1, 2, 3 });\nConsole.WriteLine(unique.Count);\nvar queue = new Queue<string>(); queue.Enqueue("first"); queue.Enqueue("second");\nConsole.WriteLine(queue.Dequeue());\nvar stack = new Stack<int>(); stack.Push(1); stack.Push(2);\nConsole.WriteLine(stack.Pop());\n'}]},
 {id:'bcl-dictionary',name:'BCL · dictionary inventory',description:'Typed dictionary indexers, key snapshots, lookups and ordinal string keys backed by the managed heap.',expectedOutput:'pencils: 12\nbooks: 5\nTotal: 17\n',files:[{uri:'Program.cs',text:'using System.Collections.Generic;\nvar stock = new Dictionary<string,int>() { {"pencils",10}, {"books",5} };\nstock["pencils"] += 2;\nint total = 0;\nforeach (var key in stock.Keys) { Console.WriteLine($"{key}: {stock[key]}"); total += stock[key]; }\nConsole.WriteLine($"Total: {total:D2}");\n'}]},
 {id:'bcl-stringbuilder',name:'BCL · text and StringBuilder',description:'String splitting/trim/casing and StringBuilder append/format/range editing using invariant formatting.',expectedOutput:'ALPHA | BETA | GAMMA\nAnswer: 0042\n',files:[{uri:'Program.cs',text:'using System.Text;\nvar words = " alpha,beta,gamma ".Trim().ToUpperInvariant().Split(",");\nvar builder = new StringBuilder();\nbuilder.Append(string.Join(" | ", words)).AppendLine();\nbuilder.AppendFormat("Answer: {0:D4}", 42);\nConsole.WriteLine(builder.ToString());\n'}]},
 {id:'csharp-interpolation',name:'C# · interpolation and numeric formats',description:'Regular/verbatim interpolated strings, escaped braces, alignment, single evaluation and deterministic supported numeric formats.',expectedOutput:'{  007} 2.50 002A\npath\\item8\n',files:[{uri:'Program.cs',text:'int item = 7;\nConsole.WriteLine($"{{{item++,5:D3}}} {2.5:F2} {42:X4}");\nConsole.WriteLine($@"path\\item{item}");\n'}]}
];
for(const e of entries){const name=e.id.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(''),records=e.files.map(f=>({path:f.uri,text:f.text}));records.push({path:name+'.csproj',text:`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework>${e.ui?'<SharpForgeProfile>WinUIWeb</SharpForgeProfile>':''}</PropertyGroup></Project>\n`},{path:name+'.slnx',text:`<Solution><Project Path="${name}.csproj" /></Solution>\n`},{path:'README.md',text:`# ${e.name}\n\n${e.description}\n\nUses the SharpForge managed/browser profile. Native WinUI/CLR portability is not asserted.\n`});const dir=join(root,'examples/release13',name);await mkdir(dir,{recursive:true});for(const r of records)await writeFile(join(dir,r.path),r.text);await writeFile(dir+'.zip',exportWorkspaceZip({records,settings:{entry:name+'.slnx',startup:name+'.csproj'}}));}
await writeFile(join(root,'apps/studio/samples-release13.js'),'// Generated by scripts/build-release13-examples.js\nexport const release13Samples='+JSON.stringify(entries,null,2)+';\n');
console.log(`Generated ${entries.length} release13 projects and ZIPs.`);
