using System;
class Holder
{
    public int Value;
    public int[] Values = new int[2];
    public ref int this[int index] { get { return ref Values[index]; } }
}
class Program
{
    static int Global;
    static ref int Identity(ref int value) { return ref value; }
    static void Alias(ref int left, ref int right) { left = 4; right += left; }
    static void Assign(out int value) { value = 9; }
    static int Read(in int value) { return value; }
    static void Fail(ref int value) { value = 12; throw new Exception("after write"); }
    static void Main()
    {
        int number = 1;
        Alias(ref number, ref number);
        Console.WriteLine(number);
        var holder = new Holder();
        Assign(out holder.Value);
        Console.WriteLine(Read(in holder.Value));
        Alias(ref holder.Values[0], ref holder.Values[0]);
        Console.WriteLine(holder.Values[0]);
        ref int alias = ref Identity(ref number);
        alias++;
        Console.WriteLine(number);
        alias = ref holder[1];
        alias = 21;
        Console.WriteLine(holder[1]);
        Assign(out Global);
        Console.WriteLine(Global);
        try { Fail(ref number); } catch (Exception) { Console.WriteLine(number); }
    }
}
