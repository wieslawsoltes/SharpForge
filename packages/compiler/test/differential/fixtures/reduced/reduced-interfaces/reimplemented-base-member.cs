using System;
public interface IA { string Who() => "IA"; int Size { get => 1; } }
public interface IB : IA { string IA.Who() => "IB"; int IA.Size => 2; }
public interface IC : IA { string IA.Who() => "IC"; }
public interface ID : IB { abstract string IA.Who(); }
public class Diamond : IB, IC { string IA.Who() => "Diamond"; }
public class OnlyB : IB { }
public class Plain : IA { public string Who() => "Plain"; }
public class Deep : ID { string IA.Who() => "Deep"; }
public static class Program
{
    public static void Main()
    {
        IA[] all = { new Diamond(), new OnlyB(), new Plain(), new Deep() };
        foreach (var a in all) Console.WriteLine(a.Who() + " " + a.Size);
    }
}
