using System;
using System.Collections.Generic;
using System.Linq;

var stages = new IStage[] { new Trimmer(), new Shouter(), new TrimShouter(), new Both(), new Custom(), new Derived(), new Hidden(), new Padder(9) };
foreach (var stage in stages.OrderBy(s => s.Order).ThenBy(s => s.Name, StringComparer.Ordinal))
    Console.WriteLine(stage.Order.ToString().PadLeft(3) + " " + stage.Name.PadRight(10) + stage.Run("  Hello ") + " | " + stage.Describe() + " | initial " + stage[0] + stage[11]);

// The same objects seen through their class type: hiding and re-implementation give different answers.
Both both = new Both();
Derived derived = new Derived();
Hidden hidden = new Hidden();
Both derivedAsBoth = derived, hiddenAsBoth = hidden;
Console.WriteLine("class view:     " + both.Run(" x ") + " " + derived.Run(" x ") + " " + hidden.Run(" x ") + " " + derivedAsBoth.Run(" x ") + " " + hiddenAsBoth.Run(" x ")
    + " orders " + both.Order + "," + derived.Order + "," + hidden.Order + "," + derivedAsBoth.Order + "," + hiddenAsBoth.Order);
Console.WriteLine("interface view: " + ((IStage)both).Run(" x ") + " " + ((IStage)derived).Run(" x ") + " " + ((IStage)hidden).Run(" x ") + " " + ((ITrim)derived).Run(" x ") + " " + ((IShout)hidden).Run(" x ")
    + " orders " + ((IStage)both).Order + "," + ((IStage)derived).Order + "," + ((IStage)hidden).Order + "," + ((IShout)derivedAsBoth).Order);

// Most specific implementation through each path of the diamond.
var diamond = new TrimShouter();
ITrim asTrim = diamond; IShout asShout = diamond; ITrimShout asBoth = diamond; IStage asStage = diamond;
Console.WriteLine("diamond: " + asTrim.Run(" a ") + asShout.Run(" b ") + asBoth.Run(" c ") + asStage.Run(" d ") + " order " + asTrim.Order + "/" + asShout.Order + "/" + asStage.Order
    + " loud " + asShout.Loud + "/" + ((IShout)new Shouter()).Loud + "/" + new Shouter().Loud + "/" + ((IShout)both).Loud);

// Default members reached through a generic constraint: no boxing, so a struct stage keeps its own state.
var padder = new Padder(6);
string first = Exec(ref padder, "ab"), second = Exec(ref padder, "cd");
IStage boxed = padder;
string third = boxed.Run("ef"), fourth = boxed.Run("gh"), fifth = Exec(ref padder, "ij");
Console.WriteLine("struct stage: " + first + second + third + fourth + fifth + " calls=" + padder.Calls + " boxedCalls=" + ((Padder)boxed).Calls + " " + ExecCopy(padder, "kl") + " calls=" + padder.Calls
    + " generic default: " + Exec(ref diamond, " z ") + " " + DescribeAll(new Trimmer(), new Custom()));

var pipeline = IStage.Compose(new Trimmer(), new Shouter(), new Custom(), new Padder(12));
Console.WriteLine("pipeline: " + pipeline.Name + " -> " + pipeline.Run("  mixed Case ") + " | " + pipeline.Describe() + " order " + pipeline.Order + " const " + IStage.DefaultOrder + " clean '" + ITrim.Clean("  q ") + "'");
Console.WriteLine("wrapped so far: " + IStage.Registered);

var dual = new DualSource();
ISource<int> numbers = dual; ISource<string> texts = dual; ISource<object> objects = dual;
Console.WriteLine("dual source: " + numbers.Next() + " " + texts.Next() + " " + numbers.Next() + " " + objects.Next() + " kinds " + numbers.Kind + "/" + texts.Kind + "/" + objects.Kind + " total " + dual.Total);

Console.WriteLine("factories: " + Make<Meter>("12").Text + " " + Make<Label>("12").Text + " " + Meter.Kind + "/" + KindOf<Meter>() + "/" + KindOf<Label>() + " " + MakeMany<Meter>("1", "2", "3").Sum(m => m.Value));

static string Exec<T>(ref T stage, string input) where T : IStage => stage.Run(input);
static string ExecCopy<T>(T stage, string input) where T : IStage => stage.Run(input) + stage.Run(input);
static string DescribeAll<T1, T2>(T1 a, T2 b) where T1 : class, ITrim where T2 : IStage, new() => a.Describe() + "&" + new T2().Describe() + "&" + ((IStage)a).Order + (a.Order + b.Order);
static T Make<T>(string argument) where T : IFactory<T> => T.Create(argument);
static string KindOf<T>() where T : IFactory<T> => T.Kind;
static List<T> MakeMany<T>(params string[] arguments) where T : IFactory<T> => arguments.Select(T.Create).ToList();

public interface IStage
{
    const int DefaultOrder = 100;
    private static int registered;
    static int Registered => registered;
    protected static string Wrap(string name, string value) { registered++; return "[" + name + ":" + value + "]"; }
    static IStage Compose(params IStage[] stages) => new Pipeline(stages);

    string Name { get; }
    int Order => DefaultOrder;
    char this[int index] => Name[index % Name.Length];
    string Run(string input) => Decorate(input);
    protected string Decorate(string value) => Wrap(Name, value);
    sealed string Describe() => Name + "@" + Order + (this is ITrim ? "+trim" : "") + (this is IShout s ? "+shout" + (s.Loud ? "!" : "") : "");

    private sealed class Pipeline : IStage
    {
        private readonly IStage[] stages;
        public Pipeline(IStage[] stages) { this.stages = stages; }
        public string Name => string.Join(">", stages.Select(s => s.Name));
        public int Order => stages.Min(s => s.Order);
        public string Run(string input) => stages.Aggregate(input, (text, stage) => stage.Run(text));
    }
}

public interface ITrim : IStage
{
    int IStage.Order => 10;
    string IStage.Run(string input) => Decorate(Clean(input));
    static string Clean(string text) => text.Trim();
}

public interface IShout : IStage
{
    int IStage.Order => 20;
    string IStage.Run(string input) => Decorate(input.ToUpperInvariant());
    bool Loud => true;
}

public interface ITrimShout : ITrim, IShout
{
    int IStage.Order => 15;
    string IStage.Run(string input) => Decorate(Clean(input).ToUpperInvariant() + "!");
}

public sealed class Trimmer : ITrim { public string Name => "trim"; }
public sealed class Shouter : IShout { public string Name => "shout"; public bool Loud => false; }
public sealed class TrimShouter : ITrimShout { public string Name => "trimshout"; }

public class Both : ITrim, IShout
{
    public virtual string Name => "both";
    public int Order => 30;
    public string Run(string input) => "<" + ITrim.Clean(input) + ">";
}

public class Derived : Both, IStage
{
    public override string Name => "derived";
    public new int Order => 5;
    public new string Run(string input) => "derived:" + base.Run(input);
}

public class Hidden : Both
{
    public override string Name => "hidden";
    public new int Order => 1;
    public new string Run(string input) => "hidden";
}

public class Custom : IStage
{
    public string Name => "custom";
    string IStage.Run(string input) => "custom(" + input.Length + ")";
    char IStage.this[int index] => '#';
}

public struct Padder : IStage
{
    private readonly int width;
    public Padder(int width) { this.width = width; Calls = 0; }
    public int Calls { get; private set; }
    public string Name => "pad" + width;
    public string Run(string input) => input.PadLeft(width, (char)('0' + Calls++ % 10));
}

public interface ISource<out T>
{
    T Next();
    string Kind => typeof(T).Name;
}

public sealed class DualSource : ISource<int>, ISource<string>
{
    public int Total { get; private set; }
    int ISource<int>.Next() => ++Total;
    string ISource<string>.Next() => "s" + (Total += 10);
    string ISource<string>.Kind => "text";
}

public interface IFactory<TSelf> where TSelf : IFactory<TSelf>
{
    static abstract TSelf Create(string argument);
    static virtual string Kind => "generic " + typeof(TSelf).Name;
    string Text { get; }
}

public readonly record struct Meter(int Value) : IFactory<Meter>
{
    public static Meter Create(string argument) => new Meter(int.Parse(argument));
    public static string Kind => "meter";
    public string Text => Value + "m";
}

public sealed class Label : IFactory<Label>
{
    private string text;
    public static Label Create(string argument) => new Label { text = "'" + argument + "'" };
    public string Text => text;
}
