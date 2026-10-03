/** Regenerate checked-in examples; no network requests or SDK are required. */
import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {exportWorkspaceZip} from '@sharpforge/project-system';
const root=fileURLToPath(new URL('../',import.meta.url));
const entries=[
{id:'csharp-modern-properties',name:'C# 14 · fields and conditional assignment',description:'Field-backed properties, target-typed construction and a null-conditional assignment whose right-hand side is skipped. This is the supported C# 14 profile, not complete C# 14.',expectedOutput:'42\n0\n',text:`using System;
class Reading
{
    public int Value { get; set { field = Math.Clamp(value, 0, 100); } }
}
class Program
{
    static int calls;
    static int Measure() { calls++; return 99; }
    static void Main()
    {
        Reading live = new() { Value = 42 };
        Reading missing = null;
        missing?.Value = Measure();
        Console.WriteLine(live.Value);
        Console.WriteLine(calls);
    }
}
`},
{id:'csharp-preview-collections',name:'C# 15 preview · capacity and labeled loops',description:'Explicit preview: collection-expression with(capacity:) prefix, spread elements and labeled break/continue. LangVersion=preview is saved in the project and workspace.',compilationOptions:{langVersion:'preview'},expectedOutput:'1,2,3,4\n22\n',text:`using System.Collections.Generic;
List<int> seed = [1, 2];
List<int> values = [with(capacity: 16), ..seed, 3, 4];
Console.WriteLine(string.Join(",", values.ToArray()));
int count = 0;
outer: for (int row = 0; row < 3; row++)
{
    for (int column = 0; column < 4; column++)
    {
        if (column == 2) continue outer;
        if (row == 2) break outer;
        count += row * 10 + column;
    }
}
Console.WriteLine(count);
`},
{id:'bcl-json-document',name:'BCL · JSON documents and serialization',description:'Bounded JSON document parsing, named properties, array enumeration, serialization and using cleanup. No reflective POCO serialization is implied.',expectedOutput:'items: 3\nTotal: 42\n{"total":42}\n',text:`using System.Collections.Generic;
using System.Text.Json;
using var document = JsonDocument.Parse("{\\\"items\\\":[10,12,20]}".Replace("\\\\", "\\"));
var items = document.RootElement.GetProperty("items");
int total = 0;
foreach (var item in items.EnumerateArray()) total += item.GetInt32();
Console.WriteLine($"items: {items.GetArrayLength()}");
Console.WriteLine($"Total: {total}");
var summary = new Dictionary<string, int>() { { "total", total } };
Console.WriteLine(JsonSerializer.Serialize(summary));
`},
{id:'bcl-array-random',name:'BCL · arrays and deterministic Random',description:'Overlap-safe Array.Copy, Fill and Clear; seeded Random state belongs to the managed heap and participates in snapshots.',expectedOutput:'1,1,2,3\n0,1,9,9\n534011718\n237820880\n',text:`using System;
int[] values = [1, 2, 3, 4];
Array.Copy(values, 0, values, 1, 3);
Console.WriteLine(string.Join(",", values));
Array.Fill(values, 9, 2, 2);
Array.Clear(values, 0, 1);
Console.WriteLine(string.Join(",", values));
var random = new Random(1);
Console.WriteLine(random.Next());
Console.WriteLine(random.Next());
`},
{id:'simd-vector-math',name:'Runtime · real SIMD vector math',description:'Fixed-lane Vector<int>/Vector<double> operations call WebAssembly SIMD when supported and scalar fallback otherwise. Open Language & Runtime for the observed backend. These are managed contracts, not native CLR value types.',expectedOutput:'20\n32\n14\n',text:`using System.Numerics;
Vector<int> a = new(2);
Vector<int> b = new(3);
Console.WriteLine(Vector.Sum(a + b));
Console.WriteLine(Vector.Dot(new Vector<int>(2), new Vector<int>(4)));
var x = new Vector<double>(new double[] { 3.0, 4.0 });
Console.WriteLine(Vector.Sum(x * new Vector<double>(2.0)));
`},
{id:'parallel-compute',name:'Runtime · isolated parallel numerical workers',description:'Independent worker pool with owned typed-array transfers. ParallelMath is a SharpForge extension, not OS threads or shared managed-memory Parallel.For. External jobs create reverse-history barriers.',expectedOutput:'sum: 6\ndot: 32\nlast: 9\n',text:`using System.Threading.Tasks;
using SharpForge.Runtime;
class Program
{
    static async Task Main()
    {
        double[] a = [1.0, 2.0, 3.0];
        double[] b = [4.0, 5.0, 6.0];
        var sum = ParallelMath.SumAsync(a);
        var dot = ParallelMath.DotAsync(a, b);
        var addition = ParallelMath.AddAsync(a, b);
        Console.WriteLine($"sum: {await sum}");
        Console.WriteLine($"dot: {await dot}");
        var result = await addition;
        Console.WriteLine($"last: {result[2]}");
    }
}
`},
{id:'network-http-client',name:'Networking · explicit-grant HTTP and JSON',description:'Starts with networking DENIED. Run scripts/network-example-server.js, grant only http://127.0.0.1:8787 in Language & Runtime, then run. Normal origin, CORS and CSP rules also apply. Grants never come from the project or ZIP.',expectedOutput:'Request blocked or failed. Review Language & Runtime grants.\n',text:`using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
class Program
{
    static async Task Main()
    {
        using var client = new HttpClient();
        client.Timeout = TimeSpan.FromSeconds(5);
        try
        {
            string json = await client.GetStringAsync("http://127.0.0.1:8787/data");
            using var document = JsonDocument.Parse(json);
            Console.WriteLine(document.RootElement.GetProperty("message").GetString());
            Console.WriteLine(document.RootElement.GetProperty("answer").GetInt32());
        }
        catch (Exception error)
        {
            Console.WriteLine("Request blocked or failed. Review Language & Runtime grants.");
        }
    }
}
`},
{id:'winui-compute-monitor',name:'WinUI · async numerical worker monitor',description:'A real managed UI callback awaits a separate compute worker. The UI stays responsive. Use the Runtime panel to inspect the actual backend and worker counters.',ui:true,expectedOutput:'',text:`using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using SharpForge.Runtime;
class Program
{
    static TextBlock status;
    static Button run;
    static async void Calculate(object sender, RoutedEventArgs args)
    {
        run.IsEnabled = false;
        status.Text = "Computing in isolated workers...";
        double[] values = new double[10000];
        for (int i = 0; i < values.Length; i++) values[i] = 0.5;
        double sum = await ParallelMath.SumAsync(values);
        status.Text = $"Completed: sum = {sum:F1}";
        run.IsEnabled = true;
    }
    static void Main()
    {
        var panel = new StackPanel() { Padding = new Thickness(28), Spacing = 18 };
        panel.Children.Add(new TextBlock() { Text = "Managed code · real compute workers", FontSize = 26 });
        status = new TextBlock() { Name = "ComputeStatus", Text = "Ready", FontSize = 20 };
        run = new Button() { Name = "ComputeButton", Content = "Calculate 10,000 values" };
        run.Click += Calculate;
        panel.Children.Add(status); panel.Children.Add(run);
        new Window() { Title = "SharpForge numerical worker monitor", Content = panel }.Activate();
    }
}
`}
];
// Keep the JSON sample ordinary readable C# rather than a JavaScript escaping puzzle.
entries.find(e=>e.id==='bcl-json-document').text=entries.find(e=>e.id==='bcl-json-document').text.replace(/^using var document =.*$/m,String.raw`using var document = JsonDocument.Parse("{\"items\":[10,12,20]}");`);
for(const e of entries){e.files=[{uri:'Program.cs',text:e.text}];delete e.text;const name=e.id.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(''),lang=e.compilationOptions?.langVersion??'14',records=e.files.map(f=>({path:f.uri,text:f.text}));records.push({path:name+'.csproj',text:`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>${lang==='preview'?'net11.0':'net10.0'}</TargetFramework><LangVersion>${lang}</LangVersion>${e.ui?'<SharpForgeProfile>WinUIWeb</SharpForgeProfile>':''}</PropertyGroup></Project>\n`},{path:name+'.slnx',text:`<Solution><Project Path="${name}.csproj" /></Solution>\n`},{path:'README.md',text:`# ${e.name}\n\n${e.description}\n\nSharpForge runtime profile. This project does not grant networking permissions or imply full native .NET/WinUI compatibility.\n`});const dir=join(root,'examples/release14',name);await mkdir(dir,{recursive:true});for(const r of records)await writeFile(join(dir,r.path),r.text);await writeFile(dir+'.zip',exportWorkspaceZip({records,settings:{entry:name+'.slnx',startup:name+'.csproj',langVersion:lang}}));}
await writeFile(join(root,'apps/studio/samples-release14.js'),'// Generated by scripts/build-release14-examples.js\nexport const release14Samples='+JSON.stringify(entries,null,2)+';\n');
console.log(`Generated ${entries.length} release14 projects and workspace ZIPs.`);
