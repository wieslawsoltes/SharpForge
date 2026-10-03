using System;

interface IValue<T> { int Read(); }
class Dual : IValue<int>, IValue<string>
{
    int IValue<int>.Read() => 40;
    int IValue<string>.Read() => 2;
}
interface ICounter { int Increment(); }
struct Counter : ICounter
{
    public int Value;
    public int Increment() { Value++; return Value; }
}
class Base<T> { public virtual T Echo(T value) => value; }
class Derived : Base<int> { public override int Echo(int value) => value + 1; }
class VirtualBase { public virtual int Read() => 1; }
class VirtualDerived : VirtualBase { public override int Read() => 42; }

static class Program
{
    static int order;
    static T Identity<T>(T value) => value;
    static int Constrained<T>(ref T value) where T : struct, ICounter => value.Increment();
    static void Out(out int value) { value = 40; }
    static void Ref(ref int value) { value += 2; }
    static int In(in int value) => value;
    static int First() { order = order * 10 + 1; return 100; }
    static int Last() { order = order * 10 + 2; return 30; }
    static int Increment(int value) => value + 1;
    static unsafe void Main()
    {
        Console.WriteLine(Identity(42));
        Console.WriteLine(Identity(9L));
        Base<int> inherited = new Derived();
        Console.WriteLine(inherited.Echo(41));
        Dual dual = new Dual();
        Console.WriteLine(((IValue<int>)dual).Read() + ((IValue<string>)dual).Read());
        Counter counter = new Counter();
        Console.WriteLine(Constrained(ref counter));
        Console.WriteLine(counter.Value);
        Out(out int number); Ref(ref number); Console.WriteLine(In(in number));
        VirtualBase target = new VirtualDerived();
        Func<int> virtualDelegate = target.Read;
        Console.WriteLine(virtualDelegate());
        Func<int> pair = First; pair += Last;
        Console.WriteLine(pair() + order);
        pair -= Last; order = 0;
        Console.WriteLine(pair() + order);
        delegate* managed<int, int> pointer = &Increment;
        Console.WriteLine(pointer(41));
    }
}
