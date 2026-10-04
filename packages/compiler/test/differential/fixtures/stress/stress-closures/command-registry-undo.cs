using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public delegate Action Command(Document document);

public sealed class Document
{
    public string Text { get; private set; } = "";
    public int Revision { get; private set; }
    public string Describe() => "\"" + Text + "\" rev" + Revision;
    public void Set(string text) { Text = text; Revision++; }
}

public sealed class Registry
{
    private readonly Dictionary<string, Func<string[], Command>> factories = new Dictionary<string, Func<string[], Command>>(StringComparer.OrdinalIgnoreCase);
    private readonly Stack<(string Name, Command Redo, Action Undo)> undo = new Stack<(string, Command, Action)>();
    private readonly Stack<(string Name, Command Redo)> redo = new Stack<(string, Command)>();
    private readonly Document document;
    public event Action<string> Executed;

    public Registry(Document document)
    {
        this.document = document;
        Register("append", args => doc => Replace(doc, doc.Text + string.Join(" ", args)));
        Register("upper", static _ => static doc => Replace(doc, doc.Text.ToUpperInvariant()));
        Register("replace", args => doc => Replace(doc, doc.Text.Replace(args[0], args[1])));
        Register("delete", args =>
        {
            int count = int.Parse(args[0], CultureInfo.InvariantCulture);
            return doc => Replace(doc, doc.Text.Substring(0, Math.Max(0, doc.Text.Length - count)));
        });
        Register("repeat", args => doc =>
        {
            Action undoAll = static () => { };
            Command inner = Create(args[1], args.Skip(2).ToArray());
            for (int i = int.Parse(args[0], CultureInfo.InvariantCulture); i > 0; i--)
            {
                Action undoOne = inner(doc), undoRest = undoAll;
                undoAll = () => { undoOne(); undoRest(); };
            }
            return undoAll;
        });
    }

    private static Action Replace(Document doc, string text)
    {
        string before = doc.Text;
        doc.Set(text);
        return () => doc.Set(before);
    }

    public void Register(string name, Func<string[], Command> factory) => factories[name] = factory;
    public IEnumerable<string> Names => factories.Keys.OrderBy(name => name, StringComparer.Ordinal);
    private Command Create(string name, string[] args) => factories.TryGetValue(name, out var factory) ? factory(args) : throw new KeyNotFoundException("unknown command '" + name + "'");

    public void Run(string line)
    {
        string[] parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        Command command = Create(parts[0], parts[1..]);
        undo.Push((parts[0], command, command(document)));
        redo.Clear();
        Executed?.Invoke(parts[0]);
    }

    public bool Undo()
    {
        if (!undo.TryPop(out var entry)) return false;
        entry.Undo();
        redo.Push((entry.Name, entry.Redo));
        Executed?.Invoke("undo:" + entry.Name);
        return true;
    }

    public bool Redo()
    {
        if (!redo.TryPop(out var entry)) return false;
        undo.Push((entry.Name, entry.Redo, entry.Redo(document)));
        Executed?.Invoke("redo:" + entry.Name);
        return true;
    }
}

public static class Program
{
    private static Command Reverse(string[] args) => ReverseCore;

    private static Action ReverseCore(Document doc)
    {
        string before = doc.Text;
        char[] chars = before.ToCharArray();
        Array.Reverse(chars);
        doc.Set(new string(chars));
        return () => doc.Set(before);
    }

    private static int Twice(int x) => x * 2;
    private static T Apply<T>(Func<T, T> function, T value, int times) { for (int i = 0; i < times; i++) value = function(value); return value; }

    public static void Main()
    {
        var document = new Document();
        var registry = new Registry(document);
        var trace = new List<string>();
        var usage = new SortedDictionary<string, int>(StringComparer.Ordinal);
        registry.Executed += trace.Add;
        Action<string> count = name => usage[name] = usage.GetValueOrDefault(name) + 1;
        registry.Executed += count;
        registry.Register("reverse", Reverse);
        int wrapped = 0;
        registry.Register("wrap", args => doc =>
        {
            wrapped++;
            string open = args.Length > 0 ? args[0] : "[", close = args.Length > 1 ? args[1] : "]";
            Action undo = ReverseCore(doc);
            undo();
            string before = doc.Text;
            doc.Set(open + before + close);
            return () => { wrapped--; doc.Set(before); };
        });
        var describe = document.Describe;
        Console.WriteLine("commands: " + string.Join(",", registry.Names) + " | " + describe());

        string[] script =
        {
            "append hello world", "upper", "replace WORLD there", "repeat 3 append !", "undo", "redo", "delete 2", "reverse", "wrap < >",
            "undo", "undo", "undo", "redo", "frobnicate now", "repeat 2 wrap", "undo", "undo", "undo", "undo", "undo", "undo", "redo", "redo",
        };
        foreach (string line in script)
        {
            string outcome;
            try
            {
                outcome = line switch
                {
                    "undo" => registry.Undo() ? "undone" : "nothing to undo",
                    "redo" => registry.Redo() ? "redone" : "nothing to redo",
                    _ => Run(line),
                };
            }
            catch (KeyNotFoundException e) { outcome = e.Message; }
            Console.WriteLine(line.PadRight(20) + outcome.PadRight(17) + " " + describe() + " wrapped=" + wrapped);
        }
        string Run(string line) { registry.Run(line); return "ok"; }

        registry.Executed -= count;
        registry.Run("append tail");
        Console.WriteLine("trace: " + string.Join(" ", trace));
        Console.WriteLine("usage: " + string.Join(" ", usage.Select(pair => pair.Key + "=" + pair.Value)) + " | events traced=" + trace.Count);

        var clamp = (int value, int low = 0, int high = 10) => Math.Min(Math.Max(value, low), high);
        var total = (params int[] values) => values.Sum();
        var twice = (int x) => x * 2;
        var pick = object (bool flag) => flag ? 1 : "one";
        var parse = (string text) => int.Parse(text, CultureInfo.InvariantCulture);
        Func<int, int, int> first = static (x, _) => x;
        Func<int, int> viaGroup = Twice;
        Console.WriteLine("defaults: " + clamp(15) + " " + clamp(-3) + " " + clamp(15, 0, 20) + " " + clamp(-3, -5) + " | params: " + total() + " " + total(1, 2, 3) + " " + total(new[] { 4, 5 }));
        Console.WriteLine("natural types: " + twice(21) + " " + pick(true) + "/" + pick(false) + " " + (parse("40") + 2) + " | discard: " + first(7, 99) + " | method group: " + Apply(viaGroup, 3, 4) + " " + Apply(twice, 1, 10) + " " + Apply(string.Concat<char>, "ab", 1));

        int raised = 0;
        EventHandler<int> onValue = (_, _) => raised++;
        onValue += (_, amount) => raised += amount;
        onValue(null, 5);
        onValue -= onValue.GetInvocationList()[0] as EventHandler<int>;
        onValue(null, 10);
        Console.WriteLine("discard handlers: raised=" + raised);
    }
}
