using System;

class A
{
    public static int Value;
    static A() { Console.WriteLine("A"); Value = B.Value + 1; }
}
class B
{
    public static int Value;
    static B() { Console.WriteLine("B"); Value = C.Value + 1; }
}
class C
{
    public static int Value;
    static C() { Console.WriteLine("C"); Value = A.Value + 1; }
}
class Broken
{
    public static int Value;
    static Broken() { Console.WriteLine("Broken"); throw new Exception("cause"); }
}
class Lazy
{
    public static int Value = Initialize();
    static int Initialize() { Console.WriteLine("Lazy"); return 9; }
    public static void Ping() { Console.WriteLine("Ping"); }
}
class Program
{
    static void Main()
    {
        Console.WriteLine(A.Value);
        Console.WriteLine(B.Value);
        Console.WriteLine(C.Value);
        for (int i = 0; i < 2; i++)
        {
            try { Console.WriteLine(Broken.Value); }
            catch (TypeInitializationException error) { Console.WriteLine(error.InnerException.Message); }
        }
        Lazy.Ping();
        Console.WriteLine("before field");
        Console.WriteLine(Lazy.Value);
    }
}
