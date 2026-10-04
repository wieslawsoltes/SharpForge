using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Runtime.CompilerServices;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class CommandAttribute : Attribute
{
    public CommandAttribute(string name, int order = 0) { Name = name; Order = order; }
    public string Name { get; }
    public int Order { get; }
    public string Help { get; set; } = "";
    public bool Hidden { get; set; }
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public sealed class HandlesAttribute<T> : Attribute
{
    public int Priority { get; set; }
    public string Payload => typeof(T).Name;
}

[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class RangeNoteAttribute : Attribute
{
    public RangeNoteAttribute(string parameter, int min, int max, params string[] tags) { Text = $"{parameter} in {min}..{max}" + (tags.Length > 0 ? " #" + string.Join("#", tags) : ""); }
    public string Text { get; }
}

public interface ICommand { string Run(int count); }

[Command("deploy", 2, Help = "ship " + nameof(DeployCommand)), Handles<int>(Priority = 1), Handles<string>]
[RangeNote(nameof(ICommand.Run), 1, 3, "safe", "audited")]
public sealed class DeployCommand : ICommand
{
    [RangeNote(nameof(count), 1, 3)]
    public string Run(int count) => "deployed x" + Guard.InRange(count, 1, 3);
}

[Command("status"), Command("st", 1, Hidden = true), Handles<List<int>>(Priority = 7)]
public sealed class StatusCommand : ICommand
{
    public string Run(int count) => Label + ":" + Guard.InRange(count * 2, 0, 5);
    private string Label
    {
        get { Guard.Trace("reading label"); return nameof(StatusCommand).Replace(nameof(ICommand).Substring(1), ""); }
    }
}

public static class Guard
{
    public static readonly List<string> Log = new List<string>();

    public static void Trace(string message, [CallerMemberName] string member = "", [CallerLineNumber] int line = 0) => Log.Add($"{member}@{line}: {message}");

    public static int InRange(int value, int min, int max, [CallerArgumentExpression(nameof(value))] string expression = "", [CallerMemberName] string member = null)
    {
        if (value < min || value > max) throw new ArgumentOutOfRangeException(expression, $"'{expression}' = {value} is outside {min}..{max} (in {member})");
        return value;
    }

    [return: NotNullIfNotNull(nameof(value))]
    public static T NotNull<T>(T value, [CallerArgumentExpression(nameof(value))] string expression = null, [CallerLineNumber] int line = 0) where T : class
        => value ?? throw new ArgumentNullException(expression, $"{expression} was null at line {line} for {nameof(T)}={typeof(T).Name}");
}

public sealed class Registry
{
    private readonly SortedDictionary<string, ICommand> _commands = new SortedDictionary<string, ICommand>(StringComparer.Ordinal);
    static Registry() { Guard.Trace("type ready"); }
    public Registry() { Guard.Trace("instance ready"); }
    public ICommand this[string name] { get { Guard.Trace("lookup " + name); return _commands.TryGetValue(name, out var found) ? found : null; } }
    public static Registry operator +(Registry registry, ICommand command) { Guard.Trace("adding"); registry.Register(command); return registry; }

    public IEnumerable<string> Register<T>(T command) where T : ICommand
    {
        var type = command.GetType();
        var lines = new List<string>();
        foreach (var attribute in Attribute.GetCustomAttributes(type, typeof(CommandAttribute)).Cast<CommandAttribute>().OrderBy(a => a.Order).ThenBy(a => a.Name, StringComparer.Ordinal))
        {
            _commands[attribute.Name] = command;
            lines.Add($"{nameof(Register)}<{typeof(T).Name}> {attribute.Name} order={attribute.Order} help='{attribute.Help}' hidden={attribute.Hidden}");
        }
        foreach (var attribute in Attribute.GetCustomAttributes(type).OrderBy(a => a.GetType().Name, StringComparer.Ordinal).ThenBy(a => a.ToString(), StringComparer.Ordinal))
        {
            string detail = attribute switch
            {
                HandlesAttribute<int> { Priority: var priority } handles => $"handles {handles.Payload} p{priority}",
                HandlesAttribute<string> handles => "handles " + handles.Payload,
                HandlesAttribute<List<int>> handles => $"handles {nameof(List<>)} of ints p{handles.Priority}",
                RangeNoteAttribute note => "note " + note.Text,
                _ => null,
            };
            if (detail != null) lines.Add("  " + detail);
        }
        lines.Add($"  ranged={Attribute.IsDefined(type, typeof(RangeNoteAttribute))} first={((CommandAttribute)Attribute.GetCustomAttributes(type, typeof(CommandAttribute)).OrderBy(a => ((CommandAttribute)a).Order).First()).Name}");
        return lines;
    }
}

public delegate bool TryParser(string text, out int value);
public delegate void Accumulate(ref int total, int amount, out bool overflowed);

public static class Program
{
    public static void Main()
    {
        var registry = new Registry();
        foreach (var line in registry.Register(new DeployCommand())) Console.WriteLine(line);
        foreach (var line in registry.Register<ICommand>(new StatusCommand())) Console.WriteLine(line);
        registry += new StatusCommand();
        Console.WriteLine(registry["deploy"].Run(2) + " " + registry["st"].Run(1) + " " + (registry["missing"] is null));

        int limit = 2;
        var attempts = new Func<object>[]
        {
            () => registry["deploy"].Run(limit * 2),
            () => registry["status"].Run(limit + 1),
            () => Guard.NotNull(registry["nope"]),
            () => Guard.NotNull(limit > 5 ? "big" : null),
            () => Guard.NotNull("fine").Length,
        };
        foreach (var attempt in attempts)
        {
            try { Console.WriteLine("ok " + attempt()); }
            catch (ArgumentException e) { Console.WriteLine(e.GetType().Name + " [" + e.ParamName + "] " + e.Message.Split('(')[0].Trim()); }
        }

        void Local() => Guard.Trace("from local function");
        Action lambda = () => Guard.Trace("from lambda");
        Local();
        lambda();
        foreach (var entry in Guard.Log) Console.WriteLine(entry);

        var parse = [Command("parse", Help = "lambda")] [Command("p", Hidden = true)] int (string text) => int.Parse(text) * 2;
        var total = (params int[] values) => values.Sum();
        var greet = (string name, string greeting = "hello", int times = 1) => string.Join(" ", Enumerable.Repeat(greeting + " " + name, times));
        var choose = object (bool flag) => flag ? 1 : "one";
        TryParser tryParse = (text, out value) => int.TryParse(text, out value) && value >= 0;
        Accumulate accumulate = (ref total, amount, out overflowed) => { overflowed = total > int.MaxValue - amount; if (!overflowed) total += amount; };
        Console.WriteLine($"{parse("21")} {parse.Invoke("-4")} {total()} {total(1, 2, 3)} {greet("ada")} | {greet("bob", "hi", 2)} | {choose(true)}{choose(false)}");
        int sum = int.MaxValue - 10;
        accumulate(ref sum, 4, out bool first);
        accumulate(ref sum, 9, out bool second);
        Console.WriteLine($"{tryParse("17", out int good)} {good} {tryParse("-4", out int negative)} {negative} {tryParse("x", out _)} {int.MaxValue - sum} {first} {second}");

        Console.WriteLine(string.Join(" ", nameof(List<>), nameof(Dictionary<,>), nameof(HandlesAttribute<>), nameof(Dictionary<string, int>.Comparer), nameof(registry), nameof(Guard.Log.Count),
            nameof(Program.Main), nameof(System.Collections.Generic), nameof(TryParser), nameof(limit), nameof(Registry.Register), nameof(Nullable<>.HasValue)));
    }
}
