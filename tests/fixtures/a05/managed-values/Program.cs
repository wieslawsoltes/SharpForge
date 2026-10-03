using System;

struct Inner
{
    public int Number;
    public string Text;
    public Inner(int number, string text) { Number = number; Text = text; }
}
struct Outer { public Inner Value; }
sealed class Holder { public Outer Value; }

static class Program
{
    static Outer Saved;
    static void Nested(ref int value) { GC.Collect(); value += 3; }
    static void Bump(ref int value) { Nested(ref value); }
    static Outer Copy(Outer value) { value.Value.Number = 99; return value; }
    static void Main()
    {
        Outer original = default;
        original.Value = new Inner(7, "keep-alive".Substring(0, 4));
        Outer copy = original;
        copy.Value.Number = 12;
        Console.WriteLine(original.Value.Number);
        Console.WriteLine(copy.Value.Number);
        Bump(ref copy.Value.Number);
        Console.WriteLine(copy.Value.Number);
        object boxed = original;
        original.Value.Number = 40;
        Outer unboxed = (Outer)boxed;
        Console.WriteLine(unboxed.Value.Number);
        Outer[] items = new Outer[2];
        items[0] = copy;
        ref Inner interior = ref items[0].Value;
        items = null;
        GC.Collect();
        Bump(ref interior.Number);
        Console.WriteLine(interior.Number);
        Console.WriteLine(interior.Text);
        Saved = copy;
        copy.Value.Number = 50;
        Console.WriteLine(Saved.Value.Number);
        Holder holder = new Holder();
        holder.Value = copy;
        ref int field = ref holder.Value.Value.Number;
        holder = null;
        Bump(ref field);
        Console.WriteLine(field);
        Outer result = Copy(original);
        Console.WriteLine(original.Value.Number);
        Console.WriteLine(result.Value.Number);
    }
}
