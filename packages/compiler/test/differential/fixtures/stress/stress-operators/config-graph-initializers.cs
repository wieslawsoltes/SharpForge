using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;

var order = new List<string>();
int sequence = 0;
int Next(string label) { order.Add(label + sequence); return sequence++; }
string Text(string value) { order.Add(value); return value; }
bool production = true;

var config = new ServerConfig
{
    Name = Text("edge"),
    Port = 8443,
    Primary = { Host = "edge-1", Port = 443, Tls = { Enabled = true, Cert = Text("edge.pem"), Ciphers = { "AES256", "CHACHA20" } }, Headers = { ["X-Env"] = production ? "prod" : "dev", ["X-Trace"] = "on" } },
    Mirrors = { { "edge-2", 444 }, new Endpoint { Host = "edge-3", Tls = { Enabled = true } }, { Text("edge-4"), 446 } },
    Tags = { "public", production ? "tls" : "plain", string.Join("-", "a", "b") },
    Env = { ["PATH"] = "/bin", ["HOME"] = "/root", ["PATH"] = "/usr/bin" },
    Limits = { { "api", 100, 20 }, { "static", new Limits(1000, 0) { Window = TimeSpan.FromMinutes(1) } } },
    Routes = { { "GET", "/health", 1 }, "/index", new Route("POST", "/submit", 5), { "PUT", "/item", 2 } },
    Matrix = { [0, 0] = 1, [1, 1] = 5, [Next("row"), Next("col")] = Next("value"), ["origin"] = { Label = "O", Value = 9 }, ["corner"] = { Value = Next("corner") } },
    Retry = new() { Attempts = 3, DelayMs = 250 },
    Startup = { "migrate", Text("warmup") },
    Weights = { [0] = 5, [2] = 7, [Next("index") - 3] = 6 },
};

Console.WriteLine("config: " + config.Name + ":" + config.Port + " env=" + config.Environment + " tags=" + string.Join(",", config.Tags) + " startup=" + string.Join(">", config.Startup) + " weights=" + string.Join("/", config.Weights) + " retry=" + config.Retry);
Console.WriteLine("primary: " + config.Primary);
foreach (Endpoint mirror in config.Mirrors) Console.WriteLine("mirror: " + mirror);
Console.WriteLine("env: " + string.Join(" ", config.Env.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + "=" + p.Value)) + " | limits: " + string.Join(" ", config.Limits.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ":" + p.Value)));
Console.WriteLine("routes: " + string.Join(" ", config.Routes) + " total weight " + config.Routes.Sum(r => r.Weight));
Console.WriteLine("matrix: " + config.Matrix + " named gets=" + config.Matrix.NamedGets + " cell sets=" + config.Matrix.CellSets);
Console.WriteLine("evaluation order: " + string.Join(" ", order));

// Required members: object initializer versus a constructor marked SetsRequiredMembers.
var viaConstructor = new ServerConfig("db", 5432) { Environment = "prod", Tags = { "internal" }, Primary = { Port = 5432 } };
Console.WriteLine("required: " + viaConstructor.Name + ":" + viaConstructor.Port + " " + viaConstructor.Environment + " " + string.Join(",", viaConstructor.Tags) + " " + viaConstructor.Primary);

// with-expressions on records, structs and anonymous types copy and then re-run the initializer part.
Limits baseLimits = new(50, 5) { Window = TimeSpan.FromSeconds(30) };
var burst = baseLimits with { Burst = 25 };
var profile = new Profile("default", baseLimits, config.Retry);
var strict = profile with { Name = "strict", Limits = profile.Limits with { Max = 10, Window = TimeSpan.FromSeconds(5) }, Retry = profile.Retry with { Attempts = 1 } };
var anonymous = new { config.Name, Ports = new[] { config.Port, config.Primary.Port }, Inner = new { Depth = 1, Label = "x" } };
var changed = anonymous with { Name = "core", Inner = anonymous.Inner with { Depth = 2 } };
Retry retry = config.Retry, slower = retry with { DelayMs = retry.DelayMs * 4 };
Console.WriteLine("with: " + baseLimits + " " + burst + " " + (burst == baseLimits) + (burst with { Burst = 5 } == baseLimits) + " | " + profile + " | " + strict);
Console.WriteLine("with: " + anonymous + " -> " + changed + " ports shared=" + ReferenceEquals(anonymous.Ports, changed.Ports) + " | " + retry + " " + slower + " original untouched=" + (config.Retry.DelayMs == 250));

// Target-typed new, nested collection initializers, element access into existing members and the failure modes.
Dictionary<string, List<int>> buckets = new() { ["even"] = new() { 2, 4 }, ["odd"] = new() { 1 }, ["even"] = { 6, 8 }, ["odd"] = { 3 } };
List<Endpoint> pool = new() { { "pool-1", 1 }, { "pool-2", 2 }, new() { Host = "pool-3", Headers = { ["k"] = "v" } } };
Dictionary<string, Limits> named = new() { { "a", 1, 2 }, { "b", new(3, 4) }, { "c", new(5, 6) { Window = TimeSpan.Zero } } };
var nested = new List<List<Route>> { new() { new("GET", "/a", 1), new("GET", "/b", 2) }, new(), new() { new("DELETE", "/c", 3) } };
Queue<int> queue = new() { 3, 1, 2 };
RouteTable expression = [new Route("HEAD", "/x", 1), .. config.Routes.Where(r => r.Weight > 1), new Route("GET", "/y", 9)];
List<string> spread = [.. config.Tags, "extra", .. viaConstructor.Tags];
Console.WriteLine("target-typed: " + string.Join(" ", buckets.OrderBy(b => b.Key, StringComparer.Ordinal).Select(b => b.Key + "=" + string.Join("+", b.Value))) + " | " + string.Join(" ", pool.Select(e => e.Host + ":" + e.Port + "/" + e.Headers.Count))
    + " | " + string.Join(" ", named.OrderBy(n => n.Key, StringComparer.Ordinal).Select(n => n.Key + n.Value.Max + n.Value.Burst + "w" + (int)n.Value.Window.TotalSeconds)) + " | " + string.Join(";", nested.Select(l => l.Count)) + " | " + queue.Dequeue() + queue.Peek() + queue.Count);
Console.WriteLine("collection expressions: " + string.Join(" ", expression) + " | " + string.Join(",", spread));
try { _ = new Dictionary<string, int> { { "x", 1 }, { "y", 2 }, { "x", 3 } }; } catch (ArgumentException) { Console.WriteLine("failure: duplicate key through Add; the indexer form overwrites: " + new Dictionary<string, int> { ["x"] = 1, ["x"] = 3 }["x"]); }
try { _ = new Dictionary<string, List<int>> { ["missing"] = { 1 } }; } catch (KeyNotFoundException) { Console.WriteLine("failure: nested collection initializer needs an existing element"); }
try { _ = new ServerConfig("x", 1) { Matrix = { [3, 0] = 1 } }; } catch (IndexOutOfRangeException) { Console.WriteLine("failure: indexer initializer out of range"); }

Console.WriteLine("generic: " + Factory.Make<Route>("made") + " " + Factory.Make<Marker>("struct").Name + " " + Factory.Many<Marker>("a", "b", "c").Length + " " + Factory.Make<Endpoint>("host") + " " + new Marker { Name = "m" }.Name.Length);

public interface INamed { string Name { get; set; } }
public struct Marker : INamed { public string Name { get; set; } }
public static class Factory
{
    public static T Make<T>(string name) where T : INamed, new() => new T { Name = name };
    public static T[] Many<T>(params string[] names) where T : struct, INamed => names.Select(n => new T { Name = n }).ToArray();
}

public sealed class Tls
{
    public bool Enabled { get; set; }
    public string Cert { get; set; } = "none";
    public List<string> Ciphers { get; } = new List<string>();
}

public sealed class Endpoint : INamed
{
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 80;
    public Tls Tls { get; } = new Tls();
    public SortedDictionary<string, string> Headers { get; } = new SortedDictionary<string, string>(StringComparer.Ordinal);
    string INamed.Name { get => Host; set => Host = value; }
    public override string ToString() => Host + ":" + Port + (Tls.Enabled ? " tls(" + Tls.Cert + (Tls.Ciphers.Count > 0 ? ";" + string.Join("|", Tls.Ciphers) : "") + ")" : "") + (Headers.Count > 0 ? " {" + string.Join(",", Headers.Select(h => h.Key + "=" + h.Value)) + "}" : "");
}

public sealed record Route(string Verb, string Path, int Weight) : INamed
{
    public Route() : this("GET", "/", 0) { }
    string INamed.Name { get => Path; set => Path = "/" + value; }
    public string Path { get; private set; } = Path;
    public override string ToString() => Verb + Path + "*" + Weight;
}

public sealed class RouteTable : IEnumerable<Route>
{
    private readonly List<Route> routes = new List<Route>();
    public void Add(string verb, string path, int weight) => routes.Add(new Route(verb, path, weight));
    public void Add(string path) => Add("GET", path, 1);
    public void Add(Route route) => routes.Add(route);
    public IEnumerator<Route> GetEnumerator() => routes.GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public record Limits(int Max, int Burst)
{
    public TimeSpan Window { get; init; } = TimeSpan.FromSeconds(1);
    public override string ToString() => Max + "/" + Burst + "/" + (int)Window.TotalSeconds + "s";
}

public struct Retry
{
    public int Attempts;
    public int DelayMs { get; set; }
    public override string ToString() => Attempts + "x" + DelayMs + "ms";
}

public sealed record Profile(string Name, Limits Limits, Retry Retry);

public sealed class Cell
{
    public string Label { get; set; } = "?";
    public int Value { get; set; }
}

public sealed class Grid
{
    private readonly int[,] cells = new int[3, 3];
    private readonly SortedDictionary<string, Cell> named = new SortedDictionary<string, Cell>(StringComparer.Ordinal);
    public int NamedGets { get; private set; }
    public int CellSets { get; private set; }
    public int this[int row, int column] { get => cells[row, column]; set { cells[row, column] = value; CellSets++; } }
    public Cell this[string name] { get { NamedGets++; return named.TryGetValue(name, out Cell cell) ? cell : named[name] = new Cell(); } }
    public override string ToString() => string.Join("|", Enumerable.Range(0, 3).Select(r => string.Join("", Enumerable.Range(0, 3).Select(c => cells[r, c])))) + " " + string.Join(",", named.Select(n => n.Key + ":" + n.Value.Label + n.Value.Value));
}

public static class InitializerExtensions
{
    public static void Add(this List<Endpoint> list, string host, int port) => list.Add(new Endpoint { Host = host, Port = port });
    public static void Add(this Dictionary<string, Limits> limits, string key, int max, int burst) => limits.Add(key, new Limits(max, burst));
    public static void Add<T>(this Queue<T> queue, T item) => queue.Enqueue(item);
}

public sealed class ServerConfig
{
    public ServerConfig() { }
    [SetsRequiredMembers] public ServerConfig(string name, int port) { Name = name; Port = port; }
    public required string Name { get; init; }
    public required int Port { get; init; }
    public string Environment { get; init; } = "dev";
    public Endpoint Primary { get; } = new Endpoint();
    public List<Endpoint> Mirrors { get; } = new List<Endpoint>();
    public List<string> Tags { get; } = new List<string> { "default" };
    public Dictionary<string, string> Env { get; } = new Dictionary<string, string>();
    public Dictionary<string, Limits> Limits { get; } = new Dictionary<string, Limits>();
    public RouteTable Routes { get; } = new RouteTable();
    public Grid Matrix { get; } = new Grid();
    public Retry Retry { get; set; }
    public Queue<string> Startup { get; } = new Queue<string>();
    public int[] Weights { get; } = new int[3];
}
