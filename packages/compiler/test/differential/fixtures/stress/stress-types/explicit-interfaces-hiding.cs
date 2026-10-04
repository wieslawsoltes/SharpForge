using System;
using System.Collections;
using System.Collections.Generic;

public interface IReader { string Read(); int Position { get; } }
public interface IWriter { void Write(string text); int Position { get; set; } }
public interface IStream : IReader, IWriter { new int Position { get; } void Reset(); }

public class Buffer : IStream, IDisposable, IEnumerable<char>, ICloneable, IFormattable
{
    private readonly List<string> chunks = new List<string>();
    private int readIndex;
    public bool Disposed { get; private set; }

    string IReader.Read() => readIndex < chunks.Count ? chunks[readIndex++] : null;
    int IReader.Position => readIndex;
    void IWriter.Write(string text) => chunks.Add(text);
    int IWriter.Position { get => chunks.Count; set => chunks.RemoveRange(value, chunks.Count - value); }
    public int Position => chunks.Count - readIndex;
    public virtual void Reset() => readIndex = 0;
    void IDisposable.Dispose() { Disposed = true; }
    public IEnumerator<char> GetEnumerator()
    {
        foreach (var chunk in chunks)
            foreach (var c in chunk)
                yield return c;
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    object ICloneable.Clone() => Clone();
    public Buffer Clone()
    {
        var copy = new Buffer();
        copy.chunks.AddRange(chunks);
        return copy;
    }
    public override string ToString() => ToString(null, null);
    public string ToString(string format, IFormatProvider provider) => format == "U" ? string.Concat(chunks).ToUpperInvariant() : string.Concat(chunks);
}

public class Base
{
    public virtual string Name => "Base";
    public string Kind() => "base-kind";
    public virtual string Virtual() => "Base.Virtual";
    public static string Static() => "Base.Static";
    public int Field = 1;
}

public class Middle : Base
{
    public override string Name => "Middle";
    public new string Kind() => "middle-kind";
    public new virtual string Virtual() => "Middle.Virtual";
    public new static string Static() => "Middle.Static";
    public new int Field = 2;
    public string BaseField => "base.Field=" + base.Field;
}

public class Leaf : Middle
{
    public sealed override string Name => "Leaf(" + base.Name + ")";
    public override string Virtual() => "Leaf.Virtual+" + base.Virtual();
}

public abstract class Template
{
    public string Run() => Before() + Core() + After();
    protected virtual string Before() => "[";
    protected abstract string Core();
    protected virtual string After() => "]";
}

public class Concrete : Template
{
    protected override string Core() => "core";
    protected override string After() => base.After() + "!";
}

public class Wrapper : Concrete
{
    protected sealed override string Before() => "<" + base.Before();
    protected override string Core() => base.Core().ToUpperInvariant();
}

public static class Program
{
    public static void Main()
    {
        var buffer = new Buffer();
        IWriter writer = buffer;
        IReader reader = buffer;
        IStream stream = buffer;
        writer.Write("ab");
        writer.Write("cd");
        writer.Write("ef");
        Console.WriteLine(reader.Read() + " " + reader.Position + " " + writer.Position + " " + stream.Position + " " + buffer.Position);
        writer.Position = 2;
        Console.WriteLine(reader.Read() + (reader.Read() ?? "<null>") + " " + string.Join("", buffer) + " " + $"{buffer:U}" + " " + buffer);
        stream.Reset();
        Console.WriteLine(((IReader)stream).Read() + " " + ((ICloneable)buffer).Clone() + " " + buffer.Clone().Position);
        using (buffer as IDisposable) { }
        Console.WriteLine(buffer.Disposed + " " + (buffer is IEnumerable) + " " + (buffer is IEnumerable<char> chars && chars != null));
        IEnumerable plain = buffer;
        int count = 0;
        foreach (object item in plain) count += item is char ? 1 : 100;
        Console.WriteLine(count);

        Leaf leaf = new Leaf();
        Middle middle = leaf;
        Base root = leaf;
        Console.WriteLine($"{leaf.Name} {middle.Name} {root.Name} | {leaf.Kind()} {middle.Kind()} {root.Kind()} | {leaf.Virtual()} / {middle.Virtual()} / {root.Virtual()}");
        Console.WriteLine($"{Base.Static()} {Middle.Static()} {Leaf.Static()} | {leaf.Field} {middle.Field} {root.Field} {((Base)middle).Field} {leaf.BaseField}");
        root.Field = 10;
        middle.Field += 5;
        Console.WriteLine(leaf.Field + " " + root.Field + " " + leaf.BaseField);
        Template[] templates = { new Concrete(), new Wrapper() };
        foreach (var template in templates) Console.Write(template.Run() + " ");
        Console.WriteLine();
        object o = leaf;
        Console.WriteLine((o is Base) + " " + (o is Middle m ? m.Kind() : "?") + " " + (o as Template == null) + " " + o.GetType().Name + " " + o.GetType().BaseType.Name + " " + typeof(Leaf).IsSubclassOf(typeof(Base)) + " " + typeof(IStream).IsAssignableFrom(typeof(Buffer)));
    }
}
