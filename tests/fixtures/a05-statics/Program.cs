using System;
class Counter<T> { public static int Value = 7; public static T Item; }
class Program {
    [ThreadStatic] public static int Local;
    public static volatile int Published;
    static void Main() {
        Counter<int>.Value = 42;
        Console.WriteLine(Counter<string>.Value);
        Console.WriteLine(Counter<int>.Value);
        Counter<int>.Item = 17;
        Counter<string>.Item = "generic";
        Console.WriteLine(Counter<int>.Item);
        Console.WriteLine(Counter<string>.Item);
        ref int address = ref Counter<int>.Value;
        address = 31;
        Console.WriteLine(Counter<int>.Value);
        Console.WriteLine(Local);
        Local = 23;
        Console.WriteLine(Local);
        Published = 11;
        Console.WriteLine(Published);
    }
}
