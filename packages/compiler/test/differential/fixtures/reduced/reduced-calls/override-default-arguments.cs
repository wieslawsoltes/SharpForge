using System;
public class Formatter
{
    public virtual string Format(string text, int width = 10, char fill = ' ', bool right = false) => right ? text.PadLeft(width, fill) : text.PadRight(width, fill);
    public virtual string Join(int first, int second = 1) => first + "," + second;
    public virtual int this[int index, int scale = 2] => index * scale;
}
public class WideFormatter : Formatter
{
    public override string Format(string text, int width = 20, char fill = '.', bool right = true) => "[" + base.Format(text, width, fill, right) + "]";
    public override string Join(int left, int right = 2) => "W" + base.Join(left, right);
    public override int this[int index, int scale = 3] => base[index, scale] + 1;
    public string ThroughThis() => Format("t", 3) + this.Join(7) + base.Join(7);
}
public sealed class WiderFormatter : WideFormatter
{
    public override string Join(int a, int b = 3) => "X" + base.Join(a, b);
}
public static class Program
{
    public static void Main()
    {
        Formatter formatter = new WideFormatter();
        var wide = new WideFormatter();
        WideFormatter wider = new WiderFormatter();
        Console.WriteLine(formatter.Format("ab") + "|" + wide.Format("ab") + "|" + wide.Format(right: false, text: "cd", width: 4));
        Console.WriteLine(formatter.Join(5) + " " + wide.Join(5) + " " + wider.Join(5) + " " + new WiderFormatter().Join(5));
        Console.WriteLine(formatter.Join(second: 9, first: 8) + " " + wide.Join(right: 9, left: 8) + " " + new WiderFormatter().Join(b: 9, a: 8));
        Console.WriteLine(wide.ThroughThis() + " " + formatter[4] + " " + wide[4]);
    }
}
