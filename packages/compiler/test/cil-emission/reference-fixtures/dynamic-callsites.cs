using System;
using Microsoft.CSharp.RuntimeBinder;

class Box
{
    public int Value;
    public byte Small { get; set; }
    public int? Optional { get; set; }
    public Action Callback { get; set; }
    public event Action Changed;
    public Box(int value) { Value = value; }
    public Box(object value) { Value = -1; }
    public int this[int index] { get { return Value + index; } set { Value = value - index; } }
    public string Pick(int value) { return "int"; }
    public string Pick(byte value) { return "byte"; }
    public string Pick(object value) { return "object"; }
    public string Named(int first, int second = 5) { return first + ":" + second; }
    public T Echo<T>(T value) { return value; }
    public void Bump(ref int value, out string result) { value += Value; result = "ref:" + value; }
    public void Ping() { Console.WriteLine("void"); }
    public void Raise() { if (Changed != null) Changed(); }
}

struct Counter
{
    public int Value;
    public void Add(int value) { Value += value; }
    public int this[int index] { get { Value += 10; return Value + index; } set { Value = value - index; } }
}

class Truth
{
    public int Value;
    public Truth(int value) { Value = value; }
    public static bool operator true(Truth value) { Console.WriteLine("true:" + value.Value); return value.Value > 0; }
    public static bool operator false(Truth value) { Console.WriteLine("false:" + value.Value); return value.Value <= 0; }
    public static Truth operator &(Truth left, Truth right) { return new Truth(left.Value + right.Value); }
    public static Truth operator |(Truth left, Truth right) { return new Truth(left.Value + right.Value); }
}

class Convertible
{
    public static implicit operator int(Convertible value) { return 11; }
    public static explicit operator byte(Convertible value) { return 12; }
}

class Program
{
    static Box shared = new Box(10);
    static dynamic Receiver() { Console.WriteLine("receiver"); return shared; }
    static int Index() { Console.WriteLine("index"); return 2; }
    static int Right() { Console.WriteLine("right"); return 3; }
    static string Overload(int value) { return "static-int"; }
    static string Overload(object value) { return "static-object"; }
    static ref Counter CounterAt(Counter[] values) { return ref values[0]; }
    static void ReadonlyCounter(in Counter counter, dynamic amount)
    {
        counter.Add(amount);
        Console.WriteLine(counter.Value);
    }
    static object Generic<T>(T value)
    {
        dynamic box = new Box(1);
        Func<object> read = () => box.Echo<T>(value);
        return read();
    }
    string Secret(int value) { return "private:" + value; }
    void PrivateCall()
    {
        dynamic self = this;
        Console.WriteLine((object)self.Secret(7));
        dynamic argument = 8;
        Console.WriteLine((object)Secret(argument));
        Func<object> delayed = () => Secret(argument);
        Console.WriteLine(delayed());
        Func<object> staticCall = () => Overload(argument);
        Console.WriteLine(staticCall());
    }
    static void Invocations()
    {
        dynamic box = new Box(4);
        object boxed = 2;
        dynamic runtime = (byte)2;
        Console.WriteLine((object)box.Pick(2));
        Console.WriteLine((object)box.Pick(boxed));
        Console.WriteLine((object)box.Pick(runtime));
        box.Ping();
        Console.WriteLine((object)box.Named(second: 2, first: 7));
        Console.WriteLine((object)box.Named(3));
        Console.WriteLine((object)box.Echo<string>("generic"));
        Console.WriteLine((object)Overload(runtime));
        Console.WriteLine((object)Program.Overload(runtime));
        Console.WriteLine(Generic(13));
        Console.WriteLine(Generic("closed"));
        var created = new Box(runtime) { Small = 1 };
        Console.WriteLine(created.Value + ":" + created.Small);
        int number = 5;
        string label;
        box.Bump(ref number, out label);
        Console.WriteLine(number + ":" + label);
        Counter counter = new Counter();
        counter.Add(runtime);
        Console.WriteLine(counter.Value);
        dynamic index = 1;
        Console.WriteLine((object)counter[index]);
        Console.WriteLine(counter.Value);
        Console.WriteLine((object)(counter[index] = 7));
        Console.WriteLine(counter.Value);
        Console.WriteLine((object)(counter[index] += Right()));
        Console.WriteLine(counter.Value);
        Counter[] counters = new Counter[] { counter };
        CounterAt(counters).Add(runtime);
        Console.WriteLine(counters[0].Value);
        ReadonlyCounter(in counter, runtime);
        dynamic callable = (Func<int, int>)(value => value * 2);
        Console.WriteLine((object)callable(6));
        new Program().PrivateCall();
        try { box.Missing(); } catch (RuntimeBinderException) { Console.WriteLine("missing"); }
        try { object result = box.Ping(); } catch (RuntimeBinderException) { Console.WriteLine("void-value"); }
    }
    static void Mutations()
    {
        dynamic box = new Box(5);
        Console.WriteLine((object)(box.Value = 8));
        Console.WriteLine((object)(box[2] = 9));
        Console.WriteLine((object)box.Value);
        box.Small = 1;
        Console.WriteLine((object)box.Small);
        Console.WriteLine((object)(box.Small += 2));
        Console.WriteLine((box.Small += 1) is byte);
        object boxed = 1;
        try { box.Small = boxed; } catch (RuntimeBinderException) { Console.WriteLine("static-object"); }
        Console.WriteLine((object)(box.Value++));
        Console.WriteLine((object)(++box.Value));
        Console.WriteLine((object)(box.Value += 2));
        Console.WriteLine((object)(Receiver()[Index()] += Right()));
        Console.WriteLine(shared.Value);
        Console.WriteLine((object)(box.Optional ??= 19));
        Console.WriteLine((object)(box.Optional ??= Right()));
        Action handler = () => Console.WriteLine("handler");
        box.Changed += handler;
        box.Raise();
        box.Changed -= handler;
        box.Raise();
        box.Callback += handler;
        box.Callback();
        box.Callback -= handler;
        Console.WriteLine((object)box.Callback == null);
        int typed = 3;
        dynamic add = 4;
        typed += add;
        Console.WriteLine(typed);
        dynamic absent = null;
        Console.WriteLine((object)absent?.Value ?? "conditional-null");
        Console.WriteLine((object)box?.Value);
    }
    static void Operators()
    {
        dynamic value = 6;
        Console.WriteLine((object)(value + 2));
        Console.WriteLine((object)(value - 2));
        Console.WriteLine((object)(value * 2));
        Console.WriteLine((object)(value / 2));
        Console.WriteLine((object)(value % 4));
        Console.WriteLine((object)(value << 1));
        Console.WriteLine((object)(value >> 1));
        Console.WriteLine((object)(value & 3));
        Console.WriteLine((object)(value | 3));
        Console.WriteLine((object)(value ^ 3));
        Console.WriteLine((object)(-value));
        Console.WriteLine((object)(~value));
        Console.WriteLine((object)(value > 2));
        Console.WriteLine((object)(value == 6));
        Console.WriteLine((object)(value != null));
        dynamic no = false;
        Console.WriteLine((object)(no && Right() > 0));
        Console.WriteLine((object)(true || no));
        dynamic zero = new Truth(0);
        dynamic yes = new Truth(2);
        if (yes) Console.WriteLine("condition");
        dynamic shorted = zero && yes;
        Console.WriteLine((object)shorted.Value);
        dynamic combined = yes && yes;
        Console.WriteLine((object)combined.Value);
        dynamic converted = new Convertible();
        int implicitValue = converted;
        byte explicitValue = (byte)converted;
        Console.WriteLine(implicitValue + ":" + explicitValue);
        dynamic narrow = 256;
        try { byte tooLarge = checked((byte)narrow); } catch (OverflowException) { Console.WriteLine("checked-convert"); }
        dynamic maximum = int.MaxValue;
        try { dynamic overflow = checked(maximum + 1); } catch (OverflowException) { Console.WriteLine("checked-add"); }
        dynamic count = 3L;
        int[] array = new int[count];
        Console.WriteLine(array.Length);
        dynamic at = 1L;
        array[at] = 21;
        Console.WriteLine(array[at]);
        int[,] grid = new int[count, 2];
        grid[at, 0] = 22;
        Console.WriteLine(grid[at, 0]);
    }
    static void Main()
    {
        Invocations();
        Mutations();
        Operators();
    }
}
