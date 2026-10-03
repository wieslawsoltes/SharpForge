using System;

class A { public virtual int F() => 1; }
class B : A { public new virtual int F() => 2; }
class C : B { public override int F() => 3; }
interface I { int F(); }
class Explicit : I { int I.F() => 7; public int F() => 8; }

class Program
{
    static void Main()
    {
        C value = new C();
        A throughA = value;
        B throughB = value;
        Console.WriteLine(throughA.F());
        Console.WriteLine(throughB.F());
        Console.WriteLine(value.F());
        I throughInterface = new Explicit();
        Console.WriteLine(throughInterface.F());
    }
}
