using System;

abstract class A
{
    public virtual int F() => 1;
    public abstract int Required();
}

class B : A
{
    public sealed override int F() => 2;
    public override int Required() => 7;
    public int BaseCall() => base.F();
}

class C : B { public new virtual int F() => 3; }
class D : C { public override int F() => 4; }

static class Program
{
    static void Main()
    {
        D value = new D();
        Console.WriteLine(((A)value).F());
        Console.WriteLine(((C)value).F());
        Console.WriteLine(value.BaseCall());
        Console.WriteLine(((A)value).Required());
    }
}
