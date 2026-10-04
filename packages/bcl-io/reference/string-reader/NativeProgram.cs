using System;
using System.IO;

class NativeProgram
{
    static void Main()
    {
        Program.Main();
        Console.WriteLine("--faults--");
        Probe(() => new StringReader(null));
        Probe(() => { StringReader reader = null; return reader.Read(); });
        foreach (string method in new[] { "Peek", "Read", "ReadLine", "ReadToEnd" })
        {
            Probe(() =>
            {
                var reader = new StringReader("");
                reader.Dispose();
                if (method == "Peek") return reader.Peek();
                if (method == "Read") return reader.Read();
                if (method == "ReadLine") return reader.ReadLine();
                return reader.ReadToEnd();
            });
        }
        TextReader parent = new StringReader("base");
        Console.WriteLine(parent.ReadLine());
        Console.WriteLine(parent is IDisposable);
        ((IDisposable)parent).Dispose();
        Probe(() => parent.Read());
    }

    static void Probe(Func<object> action)
    {
        try { action(); Console.WriteLine("NO FAULT"); }
        catch (Exception error) { Console.WriteLine(error.GetType().Name); }
    }
}
