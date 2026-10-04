using System;

class Base
{
    protected int Value;
    public Base(int value) { Value = value; }
    public virtual int Get() { return -1; }
}

class Derived : Base
{
    public Derived(int value) : base(value) { }
    public override int Get() { GC.Collect(); return Value + 100; }
}

class Program
{
    static string trace = "";
    static int A() { trace += "A"; return 1; }
    static int B() { trace += "B"; return 2; }
    static int C() { trace += "C"; return 3; }

    static void Main()
    {
        Base receiver = new Derived(42);
        Func<int> bound = receiver.Get;
        Console.WriteLine(bound == receiver.Get);
        Console.WriteLine(bound == new Derived(42).Get);
        receiver = new Derived(7);
        Console.WriteLine(bound());

        Func<int> pair = A;
        pair += B;
        Func<int> chain = pair;
        chain += C;
        chain += pair;
        chain -= pair;
        Console.WriteLine(chain());
        Console.WriteLine(trace);

        Delegate[] first = chain.GetInvocationList();
        Delegate[] second = chain.GetInvocationList();
        Console.WriteLine(first.Length);
        Console.WriteLine(ReferenceEquals(first, second));
        Console.WriteLine(first[0].Equals((Func<int>)A));
        Console.WriteLine(first[1].Equals((Func<int>)B));
        Console.WriteLine(first[2].Equals((Func<int>)C));
        first[0] = null;
        Console.WriteLine(second[0].Equals((Func<int>)A));
        trace = "";
        Console.WriteLine(chain());
        Console.WriteLine(trace);

        chain = pair + pair;
        chain -= A;
        trace = "";
        Console.WriteLine(chain());
        Console.WriteLine(trace);
        chain -= chain;
        Console.WriteLine(chain == null);

        try { Base missing = null; Func<int> invalid = missing.Get; Console.WriteLine(invalid == null); }
        catch (NullReferenceException) { Console.WriteLine("null capture"); }
        try { Func<int> missing = null; missing(); }
        catch (NullReferenceException) { Console.WriteLine("null invoke"); }
    }
}
