using System;

interface IBase { static IBase() => Console.WriteLine(10); int Value() => 1; }
interface ILeft : IBase { int IBase.Value() => 2; }
interface IRight : IBase { int IBase.Value() => 3; }
interface ILeaf : ILeft, IRight { static ILeaf() => Console.WriteLine(20); int IBase.Value() => 4; }
class Default : IBase { }
class Specific : ILeaf { }
class Implicit : ILeaf { public int Value() => 5; }
class Explicit : ILeaf { int IBase.Value() => 6; }
class Reimplemented : Default, IBase { public int Value() => 7; }

static class Program
{
    static void Print(IBase value) => Console.WriteLine(value.Value());
    static void Main()
    {
        Print(new Implicit());
        Print(new Specific());
        Print(new Default());
        Print(new Explicit());
        Print(new Reimplemented());
    }
}
