using System;
using System.IO;
using System.Text;

class NativeProgram
{
    static void Main()
    {
        if (Environment.Version.ToString() != "10.0.5") throw new Exception("Pinned runtime 10.0.5 required");
        Program.Main();
        Console.WriteLine("--native--");
        var units = new StringWriter();
        TextWriter parent = units;
        foreach (char value in new char[] {'\0', '\uD800', '\uDC00', '\uFFFF'}) parent.Write(value);
        foreach (char value in units.ToString()) Console.WriteLine((int)value);
        Console.WriteLine(parent is IDisposable);
        parent.NewLine = "|"; parent.WriteLine("base");
        Console.WriteLine(units.ToString().EndsWith("base|"));
        Console.WriteLine("--faults--");
        Probe(() => new StringWriter((StringBuilder)null));
        Probe(() => { StringWriter writer = null; return writer.ToString(); });
        foreach (string method in new[] {"char", "string", "null", "line", "line-string", "line-null"})
        {
            var writer = new StringWriter(); writer.Dispose();
            Probe(() => {
                if (method == "char") writer.Write('x');
                else if (method == "string") writer.Write("x");
                else if (method == "null") writer.Write((string)null);
                else if (method == "line") writer.WriteLine();
                else if (method == "line-string") writer.WriteLine("x");
                else writer.WriteLine((string)null);
                return null;
            });
        }
    }

    static void Probe(Func<object> action)
    {
        try { action(); Console.WriteLine("NO FAULT"); }
        catch (Exception error) { Console.WriteLine(error.GetType().Name); }
    }
}
